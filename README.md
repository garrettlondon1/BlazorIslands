# BlazorIslands

Three ways to use JavaScript in Blazor, each working the same in static SSR, enhanced navigation, streaming rendering
and Interactive Server, WebAssembly and Auto (prerendered or not), under a strict nonce-based CSP:

| You want | Use |
| --- | --- |
| A Razor component with a JS half: one JS instance per component, parameters from C#, element refs, calls both ways | `@inherits JSComponent` + collocated `.razor.js` |
| A UI that JS renders (Preact/htm, Preact TSX, React TSX, a React app spread across the page, plain modules) | `<Island>` |
| Page JavaScript that runs like it would on a full page load | `<PageScript>` |

## JS components

```razor
@* Chart.razor *@
@inherits JSComponent
<JSScope For="this">
    <canvas data-ref="canvas"></canvas>
    <button @onclick="() => InvokeJSVoidAsync(&quot;highlight&quot;, 2)">Highlight</button>
</JSScope>
@code {
    [Parameter] public double[] Values { get; set; } = [];   // -> ctx.props.values, update(params)
    [JSInvokable] public void BarClicked(int i) { ... }        // <- ctx.invokeDotNet('BarClicked', i)
}
```

```js
// Chart.razor.js: one instance per <Chart>
export default class Chart {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.on('click', 'canvas', (e) => ctx.invokeDotNet('BarClicked', this.hit(e)));  // delegated, survives re-renders
    this.draw(ctx.props.values);
  }
  update(params) { this.draw(params.values); }   // parameters changed
  rendered() { }                                  // Blazor changed the markup
  highlight(i) { }                                // InvokeJSAsync / InvokeJSVoidAsync from C#
  draw(values) { const canvas = this.ctx.ref('canvas'); /* ... */ }
  unmount() { }
}
```

- The module defaults to the collocated `.razor.js` (resolved through the static asset manifest, so it works in the
  app, its WebAssembly client project and Razor class libraries). Override `JSModule` to point elsewhere.
- `ctx.props` is every serializable `[Parameter]` in camelCase. Override `JSParameters` to send something else.
- `ctx.ref("name")` finds `data-ref="name"` live, scoped to this component (nested JS components keep their own).
  C# `ElementReference`s passed to `InvokeJSAsync` arrive as DOM elements.
- `ctx.invokeDotNet` waits while an interactive component is still prerendering, and fails with an explanation on a
  statically rendered page, where there is no .NET instance to call.
- When an interactive renderer takes over prerendered markup it re-creates every element; the JS instance is handed to
  the new markup (listeners from `ctx.on` follow it) instead of being constructed a second time.
- Plain-object modules (`export default { mount, update, unmount, ... }`) work too; their extra functions receive
  `ctx` as the last argument when called from C#.

## Islands

JavaScript islands for Blazor: Preact (htm or TSX), React (TSX, per-island roots or one app root with portals) or plain
ES modules, mounted into server-rendered Blazor pages. They work the same in static SSR, enhanced navigation,
streaming rendering and the interactive render modes, and run under a strict nonce-based Content-Security-Policy
(no `unsafe-inline`, no `unsafe-eval`).

It is also the supported replacement for page-specific `<script>` tags, which never run after enhanced navigation
([dotnet/aspnetcore#52273](https://github.com/dotnet/aspnetcore/issues/52273)).

```razor
<Island Module="islands/counter.js" Props="@(new CounterProps(5, "Clicks", null))">
    <p>Server-rendered fallback, shown until the island mounts.</p>
</Island>

<Island Bundle="islands/react-app.js" Component="Cart" Props="@cart" OnEvent="OnCartEvent" />

<PageScript Module="Components/Pages/Dashboard.razor.js" />
```

## Setup

```csharp
builder.Services.AddBlazorIslands();                 // CSP nonce, antiforgery, island JSON conventions for Minimal APIs
// WebAssembly: CspPolicyBuilder.Strict().AllowWebAssembly() adds 'wasm-unsafe-eval' (WebAssembly compilation only)
builder.Services.AddAuthentication().AddCookie(o => o.UseIslandStatusCodes()); // 401/403 for islands, not login redirects

app.UseIslandsCsp();                                  // Strict() by default; CspPolicyBuilder.StrictDynamic() is available
app.MapGroup("/api").WithIslandAntiforgery();         // Web APIs that islands call with the user's cookie
```

```razor
@* App.razor (or _Host.cshtml via <component>) *@
@inject CspNonce Nonce
<head>
    <IslandsHead />                                   @* replaces <ImportMap />: import map + runtime + config, all nonced *@
    <IslandBundle Src="islands/react-app.js" />       @* starts downloading now, in parallel with blazor.web.js *@
    ...
</head>
<body>
    <Routes />
    <script src="@Assets["_framework/blazor.web.js"]" nonce="@Nonce.Value"></script>
</body>
```

## Writing islands

| Style | Build step | How |
| --- | --- | --- |
| Plain module | none | `export function mount(ctx) { ... }` (plus optional `update(props, ctx)` and `unmount(ctx)`) |
| Preact + htm | none | `export default preactIsland(Component)` from `@blazor-islands/client/preact`; Preact comes from the import map |
| Preact TSX | esbuild | `export const islands = preactIslands({ A, B })`; keep `preact*` and `@preact/signals*` external so every island shares one Preact |
| React TSX | esbuild | `export const islands = reactIslands({ A, B })`: one React root per island |
| React app | esbuild | `createReactIslandApp({ components, wrapper })`: one root whose portals render into each island, with shared context; state above the portals survives enhanced navigation |

`ctx` gives each island its `root` (a shadow root by default), its `props`, a `signal` that aborts on unmount, and
`emit(name, detail)`, which `<Island OnEvent>` receives in interactive render modes. It also has `onPageUpdate`,
`onDispose` and `adoptStyles` (constructable stylesheets, which are CSP-safe). To call your own Web APIs, use
`islandFetch` or `islandJson`: they send the cookie and the antiforgery token, and a signed-out call gets a 401 rather
than an HTML login page.

### Types shared with .NET

Mark island props and API DTOs with `[TypeScript]`, in C# or F#, then generate declarations:

```
dotnet run --project tools/BlazorIslands.Codegen -- bin/Debug/net10.0/App.dll --out islands-src/generated/types.ts [--check]
```

C# nullable annotations and F# `option`/`voption` become `| null`. Enums become string-literal unions, records and
classes become interfaces, and generics keep their type parameters. F# unions and tuples are rejected with a message,
because System.Text.Json can't round-trip them. The JSON conventions are camelCase with enums as strings, and
`AddBlazorIslands()` applies them to Minimal APIs, so the wire format always matches the generated types.

## How it works with Blazor's DOM merge

These rules are based on `NavigationEnhancement.ts`, `DomSync.ts` and `StreamingRendering.ts` in dotnet/aspnetcore.

- **Scripts added by enhanced navigation are inert**: the new page is parsed with `DOMParser`. Custom elements still
  get `connectedCallback`, so `<blazor-island>` is the mount point and no inline script is ever needed.
- **The merge keeps an element when its tag matches at the same position.** `src`, `component` and `props` therefore
  reach a live element as attribute changes. A props change calls `update` on the same instance; a src or component
  change remounts.
- **The merge rewrites light-DOM children and removes attributes the server didn't send.** Islands therefore render into
  a shadow root, which the merge never enters, and report their state through custom states (`:state(mounted)`,
  `:state(error)`), not attributes. `Shadow="None"` islands are marked `data-permanent` instead.
- **Interactive renderers can move an element** (a disconnect and reconnect within one task). Teardown waits a
  microtask and is skipped if the element is back.
- **Islands never wait for Blazor, and Blazor never waits for islands.** The runtime is its own nonced module script.
  A slow or failed bundle keeps its fallback while the rest of the page, interactivity included, keeps working.
- **The browser keeps the first document's nonce.** Enhanced navigation can't add new trusted scripts, so islands only
  use `import()` from already-trusted modules. Under `Strict()` that works through `'self'`; under `StrictDynamic()`
  through trust propagation.

## Knowing it works: `BlazorIslands.inspect()` and the matrix

Every island, JS component and page script is tracked. In the browser console:

```js
BlazorIslands.print()     // table of every instance + any problems
BlazorIslands.inspect()   // { ok, problems, mounted, loading, orphaned, errors, stats, instances }
BlazorIslands.history()   // mount / update / handoff / connect / render / invoke / unmount, in order
BlazorIslands.blazor()    // Blazor's own lifecycle: web-started, server-started, webassembly-started, circuit-down/up...
```

`inspect().ok` is false on a leak (mounted with no element), a double mount, an element without an instance, a nested
light-DOM island or a bookkeeping mismatch, and `problems` says which.

`tests/e2e/specs/matrix.spec.ts` asserts those invariants (plus behavior) for every combination of:

- **page**: static SSR, streaming, Interactive Server / WebAssembly / Auto, each prerendered and not;
- **arrival**: full load, navigate in, navigate away, same page again, round trip, back/forward, reload, early click,
  websocket drop and reconnect (server-backed pages);
- **app mode**: enhanced navigation (default), enhanced navigation off, DOM preservation off, global Server router,
  global WebAssembly router, global Auto router;
- plus Firefox and WebKit, the `'strict-dynamic'` CSP, blazor.web.js from a local aspnetcore clone and .NET 11.

Each cell checks: the island, JS component and page script each run exactly once for the visit; prerendered pages hand
them over rather than mounting twice; props come from the final renderer; island and JS component ↔ .NET calls both
ways; .NET → page JavaScript through `IJSRuntime`; teardown on leave; `inspect()` clean; no CSP violations or uncaught
errors. `tests/e2e/matrix-report.md` is regenerated on every run, and a failing cell's error includes the island
ledger and Blazor lifecycle that led to it.

## Repository layout

| Path | What |
| --- | --- |
| `src/BlazorIslands` | Browser-safe Razor class library (runs in WebAssembly): `JSComponent`, `JSScope`, `Island`, `PageScript`, `IslandEventArgs`, `IslandJson`, `[TypeScript]`, and the JS runtime in `wwwroot` |
| `src/BlazorIslands.AspNetCore` | Server side: `IslandsHead`, `IslandBundle`, `AddBlazorIslands()`, cookie-auth and antiforgery helpers |
| `src/BlazorIslands.Server` | F#: CSP nonce middleware and policy builder (`Strict`, `StrictDynamic`, `AllowWebAssembly`), TypeScript generator |
| `src/client` | TypeScript runtime (`<blazor-island>`, lifecycle, module cache, `islandFetch`), Blazor JS initializer, Preact and React adapters. `npm run build` writes to `src/BlazorIslands/wwwroot` |
| `tools/BlazorIslands.Codegen` | `blazor-islands-codegen` CLI (F#) |
| `samples/IslandsSample` | One page per scenario, a cookie-auth Web API, the app modes (`Islands:AppMode`) and the dev hooks the tests use |
| `samples/IslandsSample.Client` | WebAssembly client: the matrix pages, `ProbeWidget` (a JS component) and the global-mode router |
| `tests/BlazorIslands.Server.Tests` | F# xUnit: generator, CSP, JSON |
| `tests/BlazorIslands.Tests` | C# xUnit: component HTML, `IslandsHead`, `IslandBundle` through the endpoint pipeline, API helpers on TestServer |
| `src/client/test` | Vitest + jsdom: element lifecycle, handoff, JS components, bundles, `islandFetch`, Preact and React adapters |
| `tests/e2e` | Playwright: feature specs on Chromium, Firefox and WebKit, and the matrix across every render mode, navigation style and app mode |

## Build and test

```powershell
npm ci
npm run build -w src/client                 # runtime -> src/BlazorIslands/wwwroot
dotnet build samples/IslandsSample          # so codegen can read the assemblies
npm run codegen -w samples/IslandsSample    # C#/F# types -> islands-src/generated/types.ts
npm run build -w samples/IslandsSample      # TSX bundles -> wwwroot/islands
dotnet build                                # again, so the static asset manifest includes the bundles

dotnet test                                 # F# + C# unit tests
npm test                                    # Vitest
npx playwright install                      # once
npm run e2e                                 # every browser and policy
```

Running against a local `dotnet/aspnetcore` clone (default `C:\Dev\aspnetcore`, after `restore.cmd`):

- **Unreleased blazor.web.js**: build `src/Components/Web.JS` (`npm run build:production`, after building the SignalR
  client). The `chromium-aspnetcore-main` project then serves it through the sample's `BLAZOR_WEB_JS` hook.
- **.NET 11**: `$env:BLAZOR_ISLANDS_NEXT = '1'` adds a `net11.0` target. Build with `C:\Dev\aspnetcore\.dotnet\dotnet.exe`
  and the `chromium-net11` project runs the sample on that runtime.
