// Licensed under the MIT license.

/** What an island module receives. Everything is torn down automatically when the island leaves the page. */
export interface IslandContext<P = unknown> {
  /** The `<blazor-island>` host element. Changes if the island is handed to a replacement element; read it, don't cache it. */
  readonly element: HTMLElement;
  /**
   * Where to render: a container inside the island's shadow root (or the host itself for `shadow="none"`). The same
   * container moves with the island when Blazor replaces its element, so framework roots created on it stay valid.
   */
  readonly root: HTMLElement;
  /** Aborted when the island unmounts. Pass it to `addEventListener` and `fetch` and cleanup is automatic. */
  readonly signal: AbortSignal;
  /** The current props, parsed from the server-rendered JSON. Updated before `update` is called. */
  readonly props: P;
  /** The module or bundle URL the island was loaded from. */
  readonly src: string;
  /** The component name within a bundle, or null for a plain module island. */
  readonly component: string | null;
  /** Unique id of this mount; changes on every remount. */
  readonly id: number;
  /**
   * Raises an event that bubbles out of the shadow root. Razor components receive it through
   * `<Island OnEvent="...">` in interactive render modes; any code can listen for `blazor-island-event`.
   */
  emit(name: string, detail?: unknown): void;
  /** Runs after enhanced navigation, streaming updates, and when an interactive renderer re-creates the DOM around the island. */
  onPageUpdate(callback: () => void): void;
  /** Runs when the island unmounts, after `unmount`. Callbacks run in reverse registration order. */
  onDispose(callback: () => void): void;
  /** Adopts constructable stylesheets into the island's root. CSP-safe: no `<style>` element, no `style` attribute. */
  adoptStyles(...sheets: Array<CSSStyleSheet | string>): void;

  /**
   * The element marked `data-ref="name"` inside this component (not inside a nested one), looked up live, so it is
   * always the element Blazor currently renders, after enhanced navigation, streaming or an interactive re-render.
   */
  ref<E extends Element = HTMLElement>(name: string): E | null;
  /**
   * Listens for a DOM event inside this island, optionally only on elements matching `selector`. Listeners follow the
   * island when Blazor replaces its element (interactive renderers re-render prerendered markup), so prefer this over
   * `ctx.element.addEventListener`. Removed automatically on unmount.
   */
  on<K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void): void;
  on<K extends keyof HTMLElementEventMap>(type: K, selector: string, handler: (event: HTMLElementEventMap[K], matched: HTMLElement) => void): void;
  /** Every element marked `data-ref="name"` inside this component. */
  refs<E extends Element = HTMLElement>(name: string): E[];
  /**
   * Runs after Blazor changes the component's markup (JS components only): an interactive re-render, an enhanced
   * navigation or a streaming update. Batched to once per task.
   */
  onRender(callback: () => void): void;
  /** True once an interactive renderer (Server, WebAssembly, Auto) owns the component and .NET can be called. */
  readonly interactive: boolean;
  /**
   * Calls a `[JSInvokable]` method on the Razor component (JS components only). Waits for the interactive renderer to
   * connect; rejects straight away on a statically rendered page, where there is no .NET to call.
   */
  invokeDotNet<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
}

/** The object Blazor's JS interop hands JavaScript for a `DotNetObjectReference`. */
export interface DotNetObjectLike {
  invokeMethodAsync<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
}

/**
 * A JS component written as a class: one instance per Razor component. The constructor (or `mount`) sets it up,
 * `update` receives new parameters, `rendered` runs after Blazor changes the markup, `unmount` tears down, and any
 * other method can be called from C# with `InvokeJSAsync("name", args...)`.
 */
export interface IslandClass<P = unknown> {
  new (ctx: IslandContext<P>): {
    mount?(ctx: IslandContext<P>): IslandCleanup | Promise<IslandCleanup>;
    update?(props: P, ctx: IslandContext<P>): void;
    rendered?(ctx: IslandContext<P>): void;
    unmount?(ctx: IslandContext<P>): void;
  };
}

/** Return a function from `mount` to have it run on unmount. */
export type IslandCleanup = void | (() => void);

/** The shape of an island module: named exports `mount`/`update`/`unmount`, or a default export of this object. */
export interface IslandDefinition<P = unknown> {
  mount(ctx: IslandContext<P>): IslandCleanup | Promise<IslandCleanup>;
  /**
   * Called when the server renders new props for a mounted island (enhanced navigation, streaming, form posts,
   * interactive re-renders). When omitted, the island is unmounted and mounted again with the new props.
   */
  update?(props: P, ctx: IslandContext<P>): void;
  /** JS components: runs after Blazor changes the component's markup. */
  rendered?(ctx: IslandContext<P>): void;
  unmount?(ctx: IslandContext<P>): void;
}

export type IslandState = 'loading' | 'mounted' | 'error';

export interface IslandLifecycleDetail {
  /**
   * mount/update/unmount/error as named; page-update after an enhanced update; handoff when a replacement element
   * (interactive renderers re-render prerendered DOM) adopts a mounted instance instead of mounting a second one.
   */
  type: 'mount' | 'update' | 'unmount' | 'error' | 'page-update' | 'handoff' | 'connect' | 'render' | 'invoke';
  src: string;
  component: string | null;
  /** Monotonic id of the island instance, unique for the page's lifetime. */
  id: number;
  /** Identity used for handoff: `island-key`, or src + component + props. */
  key: string;
  /** performance.now() when it happened. */
  at: number;
  error?: string;
  /** For unmount: how long the instance was mounted. */
  lifetimeMs?: number;
}

export interface IslandSnapshot {
  id: number;
  key: string;
  src: string;
  component: string | null;
  state: IslandState | 'orphaned';
  connected: boolean;
  handoffs: number;
  elementId: string | null;
}

/** What `inspect()` returns: a health check of every island on the page. */
export interface IslandsReport {
  /** True when no invariant is violated. */
  ok: boolean;
  /** Human-readable invariant violations: leaks, double mounts, elements without instances, bookkeeping drift. */
  problems: string[];
  elements: number;
  mounted: number;
  loading: number;
  orphaned: number;
  errors: number;
  stats: { mounted: number; mounts: number; updates: number; unmounts: number; errors: number; pageUpdates: number; handoffs: number };
  instances: IslandSnapshot[];
}

/** Name of the DOM event `ctx.emit` dispatches. */
export const islandEventName = 'blazor-island-event';

/** Name of the DOM event dispatched on `document` for every lifecycle transition. Useful for tests and diagnostics. */
export const lifecycleEventName = 'blazor-islands:lifecycle';
