# BlazorIslands

[![CI](https://github.com/garrettlondon1/BlazorIslands/actions/workflows/ci.yml/badge.svg)](https://github.com/garrettlondon1/BlazorIslands/actions/workflows/ci.yml)

> **Preview.** Not published to NuGet yet. To try it, reference the projects or pack them locally (see
> [Using it in your app](#using-it-in-your-app)). APIs may change. Community project, not affiliated with or supported
> by Microsoft or the ASP.NET Core team.

Three ways to use JavaScript in Blazor, each working the same in static SSR, enhanced navigation, streaming rendering
and Interactive Server, WebAssembly and Auto (prerendered or not), under a strict nonce-based CSP:

| You want | Use |
| --- | --- |
| A Razor component with a JS half: one JS instance per component, parameters from C#, element refs, calls both ways | `@inherits JSComponent` + collocated `.razor.js` |
| A UI that JS renders (Preact/htm, Preact TSX, React TSX, a React app spread across the page, plain modules) | `<Island>` |
| Page JavaScript that runs like it would on a full page load | `<PageScript>` |

Start with [`samples/QuickStart`](samples/QuickStart): one page per feature, each a few lines.

```powershell
npm ci && npm run build -w src/client
dotnet run --project samples/QuickStart
```

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

## Using it in your app

| Package | Reference it from | Contains |
| --- | --- | --- |
| `BlazorIslands.AspNetCore` | the server project | `IslandsHead`, `IslandBundle`, `AddBlazorIslands()`, API helpers; brings in the two below |
| `BlazorIslands` | a WebAssembly client project (optional) | `JSComponent`, `JSScope`, `Island`, `PageScript` and the JS runtime; browser-safe |
| `BlazorIslands.Server` | (transitive) | CSP middleware and policy builder, TypeScript generator (F#) |
| `BlazorIslands.Codegen` | `dotnet tool` | `blazor-islands-codegen`: TypeScript declarations for `[TypeScript]` types |

Until the packages are on NuGet, pack them into a local feed:

```powershell
npm ci; npm run build -w src/client          # the JS runtime is built into the BlazorIslands package
dotnet pack -c Release -o C:\packages\local
dotnet nuget add source C:\packages\local -n local
dotnet add package BlazorIslands.AspNetCore --prerelease
```

## Setup

```csharp
builder.Services.AddBlazorIslands();                 // CSP nonce, antiforgery, island JSON conventions for Minimal APIs
// WebAssembly: CspPolicyBuilder.Strict().AllowWebAssembly() adds 'wasm-unsafe-eval' (WebAssembly compilation only)
builder.Services.AddAuthentication().AddCookie(o => o.UseIslandStatusCodes()); // 401/403 for islands, not login redirects

app.UseIslandsCsp();                                  // Strict() by default, on HTML responses only; StrictDynamic() is available
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
than an HTML login page. Protect those endpoints with `.WithIslandAntiforgery()`. `<IslandsHead />` issues the token
itself, so this works with or without `app.UseAntiforgery()` (which .NET 11 templates no longer call).

### Types shared with .NET

Mark island props and API DTOs with `[TypeScript]`, in C# or F#, then generate declarations:

```
dotnet run --project tools/BlazorIslands.Codegen -- bin/Debug/net10.0/App.dll --out islands-src/generated/types.ts [--check]
```

C# nullable annotations and F# `option`/`voption` become `| null`. Enums become string-literal unions, records and
classes become interfaces, and generics keep their type parameters. F# unions and tuples are rejected with a message,
because System.Text.Json can't round-trip them. The JSON conventions are camelCase with enums as strings, and
`AddBlazorIslands()` applies them to Minimal APIs, so the wire format always matches the generated types.

Like Blazor's own JS interop, props and event details are serialized by their runtime type. `BlazorIslands` is marked
trimmable and has no trim warnings. Types in your app assembly survive Blazor WebAssembly's default trimming. For
fully trim-safe props, pass `JsonOptions="MyJsonContext.Default.Options"` from a source-generated `JsonSerializerContext`.

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
errors. [`docs/compatibility-matrix.md`](docs/compatibility-matrix.md) is the latest full run; `tests/e2e/matrix-report.md` is regenerated on every run, and a failing cell's error includes the island
ledger and Blazor lifecycle that led to it.

### What islands cost

Two more Chromium specs measure what the matrix can't see:

- **`profile.spec.ts`** drives repeated tours of every render mode and framework bundle and checks, through the DevTools
  protocol, that DOM nodes, listeners, island elements and instances, shadow roots, observers and abort controllers stay
  flat; that islands send nothing over the Blazor Server circuit while idle, one message per event or call when asked,
  and connect each JS component once; and that the island runtime's own script time stays under 2 ms per navigation.
  `PROFILE_RETAINERS=1` walks a heap snapshot to name whatever keeps a detached island alive.
- **`production.spec.ts`** publishes the sample and runs it in Production: every asset fingerprinted, `immutable`,
  Brotli/gzip-compressed and downloaded once (preloads included); a returning visitor downloads none; documents carry
  the CSP and are never cached; every module in the import map is pinned by SRI.

The server side is measured with BenchmarkDotNet (`benchmarks/BlazorIslands.Benchmarks`): static SSR render cost of
`<Island>` and `JSComponent` against the equivalent hand-written markup, the head components, and props serialization.

```powershell
dotnet run -c Release --project benchmarks/BlazorIslands.Benchmarks -- --filter *
# CPU samples for one scenario: dotnet-trace collect --profile dotnet-sampled-thread-time -- <exe> --loop jscomponent 10
```

## Repository layout

| Path | What |
| --- | --- |
| `src/BlazorIslands` | Browser-safe Razor class library (runs in WebAssembly): `JSComponent`, `JSScope`, `Island`, `PageScript`, `IslandEventArgs`, `IslandJson`, `[TypeScript]`, and the JS runtime in `wwwroot` |
| `src/BlazorIslands.AspNetCore` | Server side: `IslandsHead`, `IslandBundle`, `AddBlazorIslands()`, cookie-auth and antiforgery helpers |
| `src/BlazorIslands.Server` | F#: CSP nonce middleware and policy builder (`Strict`, `StrictDynamic`, `AllowWebAssembly`), TypeScript generator |
| `src/client` | TypeScript runtime (`<blazor-island>`, lifecycle, module cache, `islandFetch`), Blazor JS initializer, Preact and React adapters. `npm run build` writes to `src/BlazorIslands/wwwroot` |
| `tools/BlazorIslands.Codegen` | `blazor-islands-codegen` CLI (F#) |
| `samples/QuickStart` | The minimal example: one JS component, one Preact island, one page script |
| `samples/IslandsSample` | One page per scenario, a cookie-auth Web API, the app modes (`Islands:AppMode`) and the dev hooks the tests use |
| `samples/IslandsSample.Client` | WebAssembly client: the matrix pages, `ProbeWidget` (a JS component) and the global-mode router |
| `tests/BlazorIslands.Server.Tests` | F# xUnit: generator, CSP, JSON |
| `tests/BlazorIslands.Tests` | C# xUnit: component HTML, `IslandsHead`, `IslandBundle` through the endpoint pipeline, API helpers on TestServer |
| `src/client/test` | Vitest + jsdom: element lifecycle, handoff, JS components, bundles, `islandFetch`, Preact and React adapters |
| `tests/e2e` | Playwright: QuickStart and feature specs on Chromium, Firefox and WebKit, the matrix across every render mode, navigation style and app mode, runtime profiling and the published-app asset audit |
| `benchmarks/BlazorIslands.Benchmarks` | BenchmarkDotNet: server render cost per island and JS component, head components, props serialization |
| `eng/notices.cjs` | Regenerates `THIRD-PARTY-NOTICES.md` for the vendored Preact, signals and htm |

## Build and test

Requires the .NET 10 SDK and Node.js 22+.

```powershell
npm ci
npm run build                               # runtime, samples, codegen, TSX bundles, then the solution
npm test                                    # Vitest + C# and F# unit tests
npx playwright install                      # once
npm run e2e                                 # QuickStart, feature specs, the full matrix, profiling and the published app
```

`npm run build` runs, in order: the runtime (`src/client` → `src/BlazorIslands/wwwroot`), a sample build so codegen can
read its assemblies, codegen (C#/F# types → `islands-src/generated/types.ts`), the TSX bundles, and the solution again so
the static asset manifest includes the bundles.

Running against a local `dotnet/aspnetcore` clone (`ASPNETCORE_REPO`, or a sibling folder named `aspnetcore`, after its
restore script):

- **Unreleased blazor.web.js**: build `src/Components/Web.JS` (`npm run build:production`, after building the SignalR
  client). The `chromium-aspnetcore-main` project then serves it through the sample's `BLAZOR_WEB_JS` hook.
- **.NET 11**: `$env:BLAZOR_ISLANDS_NEXT = '1'` adds a `net11.0` target. Build with the clone's `.dotnet/dotnet`
  and the `chromium-net11` project runs the sample on that runtime.

## License

[MIT](LICENSE). The package includes unmodified builds of Preact and @preact/signals (MIT) and htm (Apache-2.0); see
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
