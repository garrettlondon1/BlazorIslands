// Licensed under the MIT license.

import {
  type DotNetObjectLike,
  type IslandClass,
  islandEventName,
  lifecycleEventName,
  type IslandCleanup,
  type IslandContext,
  type IslandDefinition,
  type IslandLifecycleDetail,
  type IslandSnapshot,
  type IslandState,
  type IslandsReport,
} from './types.js';

type ModuleLoader = (url: string) => Promise<unknown>;

interface RuntimeStats {
  mounted: number;
  mounts: number;
  updates: number;
  unmounts: number;
  errors: number;
  pageUpdates: number;
  handoffs: number;
}

/**
 * Process-wide state, kept on globalThis so that two copies of this module (one bundled into an app bundle, one loaded
 * through the import map) share one registry, one module cache and one element class.
 */
export interface IslandRuntime {
  readonly live: Set<IslandInstance>;
  readonly modules: Map<string, Promise<unknown>>;
  readonly stats: RuntimeStats;
  /** Instances whose element left the document, waiting one frame for a replacement element to adopt them. */
  readonly orphans: Map<string, IslandInstance[]>;
  /** Every lifecycle transition, oldest first, capped at `historyLimit`. */
  readonly history: IslandLifecycleDetail[];
  historyLimit: number;
  /** Problems found by `report()`'s own bookkeeping as they happen (double mounts, leaks, errors). */
  readonly problems: string[];
  loadModule: ModuleLoader;
  nextId: number;
  /**
   * Milliseconds an orphaned instance waits for adoption before it is unmounted. 0 (the default) means "until the end of
   * the current task": Blazor's renderers and DOM merge always remove and re-create elements within one task, so a
   * replacement is adopted, while an island whose page was left stops before the next user input is handled.
   */
  handoffWindowMs: number;
}

const runtimeKey = Symbol.for('blazor-islands.runtime');

export function getRuntime(): IslandRuntime {
  const g = globalThis as { [runtimeKey]?: IslandRuntime };
  return (g[runtimeKey] ??= {
    live: new Set(),
    modules: new Map(),
    stats: { mounted: 0, mounts: 0, updates: 0, unmounts: 0, errors: 0, pageUpdates: 0, handoffs: 0 },
    orphans: new Map(),
    history: [],
    historyLimit: 500,
    problems: [],
    loadModule: (url) => import(/* @vite-ignore */ /* webpackIgnore: true */ url),
    nextId: 1,
    handoffWindowMs: 0,
  });
}

/** Replaces the module loader and clears the module cache. Intended for tests and for hosts that pre-bundle islands. */
export function setModuleLoader(loader: ModuleLoader): void {
  const runtime = getRuntime();
  runtime.loadModule = loader;
  runtime.modules.clear();
}

/**
 * Imports a module once per absolute URL and shares the promise: twenty islands from one bundle cost one request, and an
 * `<IslandBundle>` preload is reused. A failed import is forgotten so a later mount can retry it.
 */
export function loadModuleOnce(src: string): Promise<unknown> {
  const runtime = getRuntime();
  const url = new URL(src, document.baseURI).href;
  let pending = runtime.modules.get(url);
  if (!pending) {
    const created = runtime.loadModule(url);
    pending = created;
    runtime.modules.set(url, created);
    created.catch(() => {
      if (runtime.modules.get(url) === created) {
        runtime.modules.delete(url);
      }
    });
  }
  return pending;
}

/** Tells every mounted island that Blazor patched the page (enhanced navigation, streaming update, enhanced form post). */
export function notifyPageUpdate(): void {
  const runtime = getRuntime();
  runtime.stats.pageUpdates++;
  for (const instance of [...runtime.live]) {
    instance.pageUpdated();
  }
}

function record(detail: IslandLifecycleDetail): void {
  const runtime = getRuntime();
  runtime.history.push(detail);
  if (runtime.history.length > runtime.historyLimit) {
    runtime.history.splice(0, runtime.history.length - runtime.historyLimit);
  }
  if (typeof document !== 'undefined') {
    document.dispatchEvent(new CustomEvent(lifecycleEventName, { detail }));
  }
}

function isDefinition(value: unknown): value is IslandDefinition<unknown> {
  return (typeof value === 'object' || typeof value === 'function') && value !== null
    && typeof (value as { mount?: unknown }).mount === 'function' && !isClass(value);
}

function isClass(value: unknown): value is IslandClass<unknown> {
  return typeof value === 'function' && /^class[\s{]/.test(Function.prototype.toString.call(value));
}

/** A definition plus, for classes, the per-instance object that C# calls with InvokeJSAsync. */
type ResolvedDefinition = IslandDefinition<unknown> & { target?(ctx: IslandContext<unknown>): Record<string, unknown> | undefined };

const classDefinitions = new WeakMap<Function, ResolvedDefinition>();

/** Adapts `export default class Chart { constructor(ctx) ... }`: one object per mounted component. */
function fromClass(Cls: IslandClass<unknown>): ResolvedDefinition {
  const cached = classDefinitions.get(Cls);
  if (cached) {
    return cached;
  }
  const objects = new WeakMap<IslandContext<unknown>, any>();
  const proto = Cls.prototype as Record<string, unknown>;
  const def: ResolvedDefinition = {
    mount(ctx) {
      const obj = new Cls(ctx);
      objects.set(ctx, obj);
      return obj.mount?.(ctx);
    },
    unmount(ctx) {
      const obj = objects.get(ctx);
      objects.delete(ctx);
      obj?.unmount?.(ctx);
    },
    target: (ctx) => objects.get(ctx),
  };
  if (typeof proto.update === 'function') {
    def.update = (props, ctx) => objects.get(ctx)?.update(props, ctx);
  }
  if (typeof proto.rendered === 'function') {
    def.rendered = (ctx) => objects.get(ctx)?.rendered(ctx);
  }
  classDefinitions.set(Cls, def);
  return def;
}

function asDefinition(value: unknown): ResolvedDefinition | undefined {
  if (isClass(value)) {
    return fromClass(value);
  }
  return isDefinition(value) ? value : undefined;
}

/**
 * Finds the island in a loaded module.
 * - No component name: the module itself is the island (named `mount`/`update`/`unmount` exports, or a default export object).
 * - A component name: the module is a bundle; looks in its `islands` export, then its default export, then a named export.
 */
export function resolveDefinition(mod: unknown, src: string, component: string | null): ResolvedDefinition {
  const m = (mod ?? {}) as Record<string, unknown>;
  if (!component) {
    const found = asDefinition(m.default) ?? (isDefinition(m) ? m : undefined);
    if (found) {
      return found;
    }
    throw new TypeError(`Island module '${src}' must export a mount(ctx) function, a default export with one, or a default export class.`);
  }
  for (const registry of [m.islands, m.default]) {
    const candidate = asDefinition((registry as Record<string, unknown> | undefined)?.[component]);
    if (candidate) {
      return candidate;
    }
  }
  const named = asDefinition(m[component]);
  if (named) {
    return named;
  }
  const registry = (m.islands ?? m.default ?? {}) as object;
  throw new TypeError(`Bundle '${src}' has no island named '${component}'. Available: ${Object.keys(registry).join(', ') || '(none)'}.`);
}

function parseProps(json: string | null): unknown {
  return json === null || json === '' ? undefined : JSON.parse(json);
}

function toSheet(sheet: CSSStyleSheet | string): CSSStyleSheet {
  if (typeof sheet !== 'string') {
    return sheet;
  }
  const s = new CSSStyleSheet();
  s.replaceSync(sheet);
  return s;
}

let hostSheet: CSSStyleSheet | undefined;
function getHostSheet(): CSSStyleSheet | undefined {
  if (!hostSheet && typeof CSSStyleSheet !== 'undefined' && 'replaceSync' in CSSStyleSheet.prototype) {
    hostSheet = toSheet(':host{display:block}:host([hidden]){display:none}.island-root{display:contents}');
  }
  return hostSheet;
}

/** The element-side contract an instance needs. Implemented by the custom element. */
export interface IslandHost {
  readonly element: HTMLElement;
  /** JS component: Blazor renders and owns the children; the runtime never adds, moves or removes them. */
  readonly attach: boolean;
  /** The container the island renders into. Survives handoff: it moves with the instance to the adopting element. */
  readonly root: HTMLElement;
  showContainer(container: HTMLElement): void;
  showFallback(): void;
  setState(state: IslandState, on: boolean): void;
  /** Settles when the island's stylesheets (`styles` attribute) have loaded or failed, so it never paints unstyled. */
  stylesReady?(): Promise<void>;
}

/**
 * One mount of one island. A src or component change, or a remount for props, creates a new instance. When Blazor
 * replaces the element (interactive renderers clear prerendered DOM and render it again), the instance moves to the new
 * element instead of unmounting: its container, DOM, framework roots and state come along.
 */
export class IslandInstance {
  readonly id: number;
  readonly controller = new AbortController();
  key: string;
  state: IslandState = 'loading';
  host: IslandHost;
  /** True for shadow="none": the island renders into the host element itself, so its children move on handoff. */
  readonly lightDom: boolean;
  private readonly shadowContainer: HTMLElement | undefined;
  handoffs = 0;
  mountedAt = 0;
  private definition: ResolvedDefinition | undefined;
  private readonly disposers: Array<() => void> = [];
  private readonly renderCallbacks: Array<() => void> = [];
  private readonly listeners: Array<{ type: string; selector: string | null; handler: (e: Event, matched: Element) => void }> = [];
  private listenerBinding: AbortController | undefined;
  private observer: MutationObserver | undefined;
  private renderQueued = false;
  private dotnet: DotNetObjectLike | null = null;
  private readonly dotnetWaiters: Array<(ref: DotNetObjectLike) => void> = [];
  private readyResolve!: () => void;
  private readyReject!: (e: unknown) => void;
  /** Settles when the island mounts (or fails / is disposed first). */
  readonly ready: Promise<void> = new Promise((resolve, reject) => {
    this.readyResolve = resolve;
    this.readyReject = reject;
  });

  private readonly pageUpdateCallbacks: Array<() => void> = [];
  private readonly documentSheets: CSSStyleSheet[] = [];
  private readonly context: IslandContext<unknown>;
  private orphanTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    host: IslandHost,
    readonly src: string,
    readonly component: string | null,
    private currentProps: unknown,
    key: string,
    lightDom: boolean,
  ) {
    this.host = host;
    this.key = key;
    this.id = getRuntime().nextId++;
    // Only invoke() awaits readiness; an island that unmounts or fails with no pending call must not raise an
    // "unhandled rejection" in the page.
    this.ready.catch(() => undefined);
    this.lightDom = lightDom;
    if (!lightDom) {
      this.shadowContainer = document.createElement('div');
      this.shadowContainer.className = 'island-root';
      this.shadowContainer.setAttribute('part', 'root');
    }
    const instance = this;
    this.context = {
      get element() { return instance.host.element; },
      get root() { return instance.container; },
      get signal() { return instance.controller.signal; },
      get props() { return instance.currentProps; },
      get src() { return instance.src; },
      get component() { return instance.component; },
      get id() { return instance.id; },
      emit(name, detail) {
        instance.host.element.dispatchEvent(new CustomEvent(islandEventName, {
          bubbles: true,
          composed: true,
          detail: { name, detail: detail === undefined ? null : detail },
        }));
      },
      onPageUpdate(callback) { instance.pageUpdateCallbacks.push(callback); },
      onDispose(callback) { instance.disposers.push(callback); },
      ref(name) {
        return (instance.refs(name)[0] ?? null) as any;
      },
      refs(name) {
        return instance.refs(name) as any;
      },
      onRender(callback) { instance.renderCallbacks.push(callback); },
      on(type: string, selectorOrHandler: unknown, maybeHandler?: unknown) {
        const selector = typeof selectorOrHandler === 'string' ? selectorOrHandler : null;
        const handler = (selector ? maybeHandler : selectorOrHandler) as (e: Event, matched: Element) => void;
        instance.listeners.push({ type, selector, handler });
        instance.bindListeners();
      },
      get interactive() { return instance.dotnet !== null; },
      invokeDotNet(method, ...args) { return instance.invokeDotNet(method, args) as any; },
      adoptStyles(...sheets) {
        const adopted = sheets.map(toSheet);
        const root = instance.container.getRootNode();
        if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) {
          root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...adopted];
        } else {
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, ...adopted];
          instance.documentSheets.push(...adopted);
        }
      },
    };
  }

  get disposed(): boolean {
    return this.controller.signal.aborted;
  }

  /** Takes a new identity when the element's island-key changes while the island stays mounted. */
  rekey(key: string): void {
    if (this.orphanTimer === undefined) {
      this.key = key;
    }
  }

  get attach(): boolean {
    return this.host.attach;
  }

  /** Elements marked data-ref="name" in this island's own scope (nested islands and JS components excluded). */
  refs(name: string): Element[] {
    const scope = this.container;
    const selector = `[data-ref="${cssEscape(name)}"]`;
    return [...scope.querySelectorAll(selector)].filter((el) => {
      // Inside a shadow root closest() stops at the boundary (null); in light DOM the nearest island must be this one.
      const owner = el.parentElement?.closest(elementName) ?? null;
      return owner === null || owner === this.host.element;
    });
  }

  /** (Re)attaches ctx.on listeners to the current host or container. Called on mount, handoff and each new listener. */
  bindListeners(): void {
    this.listenerBinding?.abort();
    if (this.disposed || this.listeners.length === 0) {
      return;
    }
    const binding = new AbortController();
    this.listenerBinding = binding;
    this.controller.signal.addEventListener('abort', () => binding.abort(), { once: true, signal: binding.signal });
    const target: Element = this.attach || this.lightDom ? this.host.element : this.container;
    const types = new Set(this.listeners.map((l) => l.type));
    for (const type of types) {
      target.addEventListener(type, (event) => {
        for (const listener of this.listeners) {
          if (listener.type !== type) {
            continue;
          }
          let matched: Element | null = target;
          if (listener.selector) {
            const origin = event.target instanceof Element ? event.target : null;
            matched = origin?.closest(listener.selector) ?? null;
            // Must be inside this island's own scope, not a nested island's. Inside a shadow root closest() stops at
            // the boundary, so the nearest island is null; in light DOM it must be this island's host.
            const scopeOwner = this.attach || this.lightDom ? target : null;
            if (!matched || !target.contains(matched) || (matched.parentElement?.closest(elementName) ?? null) !== scopeOwner) {
              continue;
            }
          }
          this.withoutRenderObservation(() => listener.handler(event, matched!));
        }
      }, { signal: binding.signal });
    }
  }

  /** DOM changes the island's own code makes are not Blazor renders: don't report them through rendered(). */
  private withoutRenderObservation(work: () => unknown): void {
    this.observer?.disconnect();
    try {
      const result = work();
      if (result instanceof Promise) {
        result.catch((error) => console.error(`[BlazorIslands] Event handler in '${this.label}' failed.`, error));
      }
    } finally {
      this.observer?.takeRecords();
      if (this.state === 'mounted') {
        this.observe();
      }
    }
  }

  /** Receives the DotNetObjectReference from the Razor component once an interactive renderer owns it. */
  connect(ref: DotNetObjectLike | null): void {
    this.dotnet = ref;
    if (ref) {
      for (const waiter of this.dotnetWaiters.splice(0)) {
        waiter(ref);
      }
      record(this.detail('connect'));
    }
  }

  async invokeDotNet(method: string, args: unknown[]): Promise<unknown> {
    if (this.dotnet) {
      return this.dotnet.invokeMethodAsync(method, ...args);
    }
    if (!this.host.element.hasAttribute('interactive') && !this.host.element.hasAttribute('interactive-pending')) {
      throw new Error(`Cannot call .NET method '${method}' from '${this.label}': this component is statically rendered, so there is no .NET instance to call. Give it an interactive render mode.`);
    }
    const ref = await new Promise<DotNetObjectLike>((resolve, reject) => {
      this.dotnetWaiters.push(resolve);
      this.controller.signal.addEventListener('abort', () => reject(new Error(`'${this.label}' unmounted before .NET connected.`)), { once: true });
    });
    return ref.invokeMethodAsync(method, ...args);
  }

  /** Calls a method on the JS component: a class instance method, or a definition function with ctx appended. */
  async invoke(method: string, args: unknown[]): Promise<unknown> {
    await this.ready;
    const target = this.definition?.target?.(this.context);
    const owner: Record<string, unknown> | undefined = target ?? (this.definition as unknown as Record<string, unknown>);
    const fn = owner?.[method];
    if (typeof fn !== 'function' || ['mount', 'update', 'unmount', 'rendered', 'constructor'].includes(method)) {
      throw new Error(`'${this.label}' has no method '${method}' that .NET can call.`);
    }
    record(this.detail('invoke'));
    return target ? fn.apply(target, args) : fn.apply(owner, [...args, this.context]);
  }

  /** JS components: re-run render callbacks after Blazor changes the markup, at most once per task. */
  private observe(): void {
    if (!this.attach || typeof MutationObserver === 'undefined') {
      return;
    }
    this.observer?.disconnect();
    this.observer ??= new MutationObserver((records) => {
      const host = this.host.element;
      if (records.every((r) => r.target === host && r.type === 'attributes')) {
        return;
      }
      this.queueRender();
    });
    this.observer.observe(this.host.element, { childList: true, subtree: true, characterData: true, attributes: true });
  }

  private queueRender(): void {
    if (this.renderQueued || this.state !== 'mounted') {
      return;
    }
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      if (this.state !== 'mounted' || this.disposed) {
        return;
      }
      // Changes made by the callbacks themselves must not trigger another round.
      this.observer?.disconnect();
      try {
        this.definition?.rendered?.(this.context);
        for (const callback of this.renderCallbacks) {
          callback();
        }
      } catch (error) {
        console.error(`[BlazorIslands] Render callback in '${this.label}' threw.`, error);
      } finally {
        this.observer?.takeRecords();
        this.observe();
      }
      record(this.detail('render'));
    });
  }

  /**
   * The element this instance renders into. For shadow islands, a container inside the shadow root that is moved, never
   * recreated, when the instance is handed to a new host. For light-DOM islands, the host itself.
   */
  get container(): HTMLElement {
    return this.shadowContainer ?? this.host.element;
  }

  get props(): unknown {
    return this.currentProps;
  }

  get label(): string {
    return this.component ? `${this.src}#${this.component}` : this.src;
  }

  get orphaned(): boolean {
    return this.orphanTimer !== undefined;
  }

  private detail(type: IslandLifecycleDetail['type'], extra: Partial<IslandLifecycleDetail> = {}): IslandLifecycleDetail {
    return { type, src: this.src, component: this.component, id: this.id, key: this.key, at: now(), ...extra };
  }

  /**
   * Waits for the current host's stylesheets. A handoff while waiting (an interactive renderer replacing the
   * prerendered element) removes the old element, which cancels its stylesheet loads: follow the island to its new host.
   */
  private async stylesReady(): Promise<void> {
    for (;;) {
      const host = this.host;
      const moved = new Promise<void>((resolve) => { this.onHostChange = resolve; });
      await Promise.race([host.stylesReady?.() ?? Promise.resolve(), moved]);
      this.onHostChange = undefined;
      if (this.host === host || this.disposed) {
        return;
      }
    }
  }

  private onHostChange: (() => void) | undefined;

  async start(): Promise<void> {
    const runtime = getRuntime();
    runtime.live.add(this);
    this.host.showFallback();
    try {
      // No timeout: a slow bundle keeps the server-rendered fallback on screen until it arrives.
      const mod = await loadModuleOnce(this.src);
      if (this.disposed) {
        return;
      }
      this.definition = resolveDefinition(mod, this.src, this.component);
      // Stylesheets started loading with the fallback; don't paint the island before they apply.
      await this.stylesReady();
      if (this.disposed) {
        return;
      }
      if (!this.attach) {
        this.host.showContainer(this.container);
      }
      const cleanup: IslandCleanup = await this.definition.mount(this.context);
      if (typeof cleanup === 'function') {
        this.disposers.push(cleanup);
      }
      this.state = 'mounted';
      this.mountedAt = now();
      runtime.stats.mounts++;
      runtime.stats.mounted++;
      if (this.disposed) {
        // Unmounted while an async mount was running: undo what the mount just set up.
        this.teardown();
        return;
      }
      this.host.setState('mounted', true);
      this.observe();
      this.bindListeners();
      record(this.detail('mount'));
      this.readyResolve();
    } catch (error) {
      this.readyReject(error);
      if (this.disposed) {
        return;
      }
      this.state = 'error';
      runtime.stats.errors++;
      runtime.live.delete(this);
      this.host.showFallback();
      this.host.setState('error', true);
      console.error(`[BlazorIslands] Island '${this.label}' failed to mount.`, error);
      record(this.detail('error', { error: error instanceof Error ? error.message : String(error) }));
    }
  }

  /** Returns false when the definition has no `update` and the caller must remount. */
  setProps(props: unknown): boolean {
    this.currentProps = props;
    if (this.state !== 'mounted') {
      // Still loading: mount reads the latest props.
      return this.state === 'loading';
    }
    if (!this.definition?.update) {
      return false;
    }
    try {
      this.definition.update(props, this.context);
      getRuntime().stats.updates++;
      record(this.detail('update'));
    } catch (error) {
      console.error(`[BlazorIslands] Island '${this.label}' failed to update.`, error);
      record(this.detail('error', { error: error instanceof Error ? error.message : String(error) }));
    }
    return true;
  }

  pageUpdated(): void {
    // Blazor fires 'enhancedload' synchronously after the merge, before the disconnect of a removed element has been
    // processed: an island whose element just left the page must not be told about the page that replaced it.
    if (this.state !== 'mounted' || this.pageUpdateCallbacks.length === 0 || this.orphaned || !this.host.element.isConnected) {
      return;
    }
    for (const callback of this.pageUpdateCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error(`[BlazorIslands] onPageUpdate callback in '${this.label}' threw.`, error);
      }
    }
    record(this.detail('page-update'));
  }

  /** The element left the document: wait briefly for a replacement element with the same key to adopt this instance. */
  orphan(): void {
    if (this.disposed || this.orphaned) {
      return;
    }
    const runtime = getRuntime();
    const list = runtime.orphans.get(this.key) ?? [];
    list.push(this);
    runtime.orphans.set(this.key, list);
    this.orphanTimer = setTimeout(() => {
      this.orphanTimer = undefined;
      removeOrphan(this);
      this.dispose();
    }, runtime.handoffWindowMs);
  }

  /** Moves this instance (container, DOM, state, listeners) to a new host element. */
  adopt(host: IslandHost, props: unknown): void {
    if (this.orphanTimer !== undefined) {
      clearTimeout(this.orphanTimer);
      this.orphanTimer = undefined;
    }
    removeOrphan(this);
    const from = this.host.element;
    this.host = host;
    this.handoffs++;
    getRuntime().stats.handoffs++;
    this.onHostChange?.();
    if (this.attach) {
      // Blazor already rendered the component's markup into the new element; nothing to move.
      if (this.state === 'mounted') {
        host.setState('mounted', true);
        this.observe();
      }
      this.bindListeners();
    } else if (this.lightDom) {
      // Move what the island rendered; never the old host element itself.
      if (this.state === 'mounted') {
        host.element.replaceChildren(...from.childNodes);
        host.setState('mounted', true);
      }
      this.bindListeners();
    } else if (this.state === 'mounted') {
      host.showContainer(this.container);
      host.setState('mounted', true);
    } else {
      host.showFallback();
    }
    record(this.detail('handoff'));
    if (JSON.stringify(props) !== JSON.stringify(this.currentProps)) {
      this.setProps(props);
    }
    // The renderer just re-created the DOM around this island: page scripts re-apply whatever they did to it.
    this.pageUpdated();
    if (this.attach) {
      this.queueRender();
    }
    void from;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    if (this.orphanTimer !== undefined) {
      clearTimeout(this.orphanTimer);
      this.orphanTimer = undefined;
      removeOrphan(this);
    }
    const wasMounted = this.state === 'mounted';
    this.controller.abort();
    this.onHostChange?.();
    this.observer?.disconnect();
    this.dotnet = null;
    this.readyReject(new Error(`'${this.label}' was unmounted.`));
    getRuntime().live.delete(this);
    if (wasMounted) {
      this.teardown();
    }
  }

  private teardown(): void {
    const runtime = getRuntime();
    try {
      this.definition?.unmount?.(this.context);
    } catch (error) {
      console.error(`[BlazorIslands] Island '${this.label}' threw during unmount.`, error);
    }
    for (const dispose of this.disposers.splice(0).reverse()) {
      try {
        dispose();
      } catch (error) {
        console.error(`[BlazorIslands] A dispose callback in '${this.label}' threw.`, error);
      }
    }
    if (this.documentSheets.length > 0) {
      const remove = new Set(this.documentSheets.splice(0));
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => !remove.has(s));
    }
    runtime.stats.mounted--;
    runtime.stats.unmounts++;
    this.state = 'loading';
    if (this.shadowContainer) {
      this.shadowContainer.replaceChildren();
      this.shadowContainer.remove();
    } else if (!this.attach) {
      this.host.element.replaceChildren();
    }
    this.host.showFallback();
    this.host.setState('mounted', false);
    record(this.detail('unmount', { lifetimeMs: this.mountedAt ? Math.round(now() - this.mountedAt) : 0 }));
  }

  snapshot(): IslandSnapshot {
    return {
      id: this.id,
      key: this.key,
      src: this.src,
      component: this.component,
      state: this.orphaned ? 'orphaned' : this.state,
      connected: this.host.element.isConnected,
      handoffs: this.handoffs,
      elementId: this.host.element.id || null,
    };
  }
}

function removeOrphan(instance: IslandInstance): void {
  const orphans = getRuntime().orphans;
  const list = orphans.get(instance.key);
  if (!list) {
    return;
  }
  const i = list.indexOf(instance);
  if (i >= 0) {
    list.splice(i, 1);
  }
  if (list.length === 0) {
    orphans.delete(instance.key);
  }
}

function takeOrphan(key: string): IslandInstance | undefined {
  const list = getRuntime().orphans.get(key);
  return list?.[0];
}

/** CSS.escape where available; a quote-and-backslash escape (enough inside a quoted attribute selector) otherwise. */
function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * `<blazor-island src="module-or-bundle.js" component="Name" props="{json}" shadow="open|closed|none" island-key="...">`.
 *
 * Lifecycle rules, all derived from how Blazor updates the DOM:
 * - Enhanced navigation and streaming rendering keep an element when the tag at that position matches, so `src`,
 *   `component` and `props` arrive as attribute changes on a live element: a src/component change remounts, a props
 *   change calls `update`.
 * - The DOM merge rewrites light-DOM children and strips attributes the server did not render, so the island renders into
 *   a shadow root (which the merge never visits) and reports state through custom states (`:state(mounted)`), not attributes.
 * - Interactive renderers clear prerendered DOM when they start and render it again, and may move elements. A removed
 *   element's instance is kept for one short window; a new element with the same key adopts it, so the island keeps its
 *   DOM and state and mounts exactly once.
 */
export class BlazorIslandElement extends HTMLElement implements IslandHost {
  static readonly observedAttributes = ['src', 'component', 'props', 'styles', 'island-key'];

  #internals: ElementInternals | undefined;
  #shadow: ShadowRoot | undefined;
  #instance: IslandInstance | undefined;
  #teardownPending = false;
  #startQueued = false;
  #pendingDotNet: DotNetObjectLike | null = null;
  #failed = false;
  #slot: HTMLSlotElement | undefined;
  #styleLinks: HTMLLinkElement[] | undefined;
  #stylesLoaded: Promise<void> | undefined;
  #restartQueued = false;

  constructor() {
    super();
    try {
      this.#internals = this.attachInternals();
    } catch {
      this.#internals = undefined;
    }
    this.#shadow = this.#internals?.shadowRoot ?? undefined;
  }

  get element(): HTMLElement {
    return this;
  }

  get root(): HTMLElement {
    return this.#instance?.container ?? this;
  }

  /** The current lifecycle state. */
  get islandState(): IslandState | 'idle' {
    return this.#instance?.state ?? 'idle';
  }

  /** The props currently applied. */
  get islandProps(): unknown {
    return this.#instance?.props;
  }

  /** The id of the current instance; changes on every remount, kept across handoffs. */
  get islandId(): number | undefined {
    return this.#instance?.id;
  }

  /** JS component host: Blazor owns the children, the JS module attaches behavior to them. */
  get attach(): boolean {
    return this.hasAttribute('attach');
  }

  get shadowMode(): 'open' | 'closed' | 'none' {
    if (this.attach) {
      return 'none';
    }
    const value = this.getAttribute('shadow');
    return value === 'closed' || value === 'none' ? value : 'open';
  }

  /** Identity used to hand an instance to a replacement element: `island-key`, or src + component + props. */
  get islandKey(): string {
    return this.getAttribute('island-key')
      ?? `${this.getAttribute('src') ?? ''}#${this.getAttribute('component') ?? ''}#${this.getAttribute('props') ?? ''}`;
  }

  connectedCallback(): void {
    this.#teardownPending = false;
    if (!this.#instance) {
      this.#scheduleStart();
    }
  }

  /**
   * Starts on a microtask rather than synchronously. When a renderer replaces nodes it removes the old element and
   * inserts the new one in the same task; the old element's disconnect microtask is queued first, so by the time this
   * runs its instance is waiting as an orphan and can be adopted instead of mounting a second time.
   */
  #scheduleStart(): void {
    if (this.#startQueued) {
      return;
    }
    this.#startQueued = true;
    queueMicrotask(() => {
      this.#startQueued = false;
      if (this.isConnected && !this.#instance) {
        this.#start();
      }
    });
  }

  /**
   * Blazor's DOM merge updates a reused element's attributes one at a time (src, then island-key, then props...).
   * Restarting on the first change would start the new island with the previous island's key or props, so restart once
   * the whole update has been applied.
   */
  #scheduleRestart(): void {
    if (this.#restartQueued) {
      return;
    }
    this.#restartQueued = true;
    queueMicrotask(() => {
      this.#restartQueued = false;
      if (this.isConnected) {
        this.#stop();
        this.#start();
      }
    });
  }

  disconnectedCallback(): void {
    this.#teardownPending = true;
    queueMicrotask(() => {
      if (this.#teardownPending && !this.isConnected) {
        this.#teardownPending = false;
        const instance = this.#instance;
        this.#instance = undefined;
        this.setState('mounted', false);
        // Not unmounted yet: a replacement element may adopt it (interactive renderers re-render prerendered DOM).
        instance?.orphan();
      }
    });
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue || !this.isConnected) {
      return;
    }
    if (name === 'styles') {
      this.#replaceStyles();
      return;
    }
    if (!this.#instance) {
      // Never started (no src yet) or failed: try again with the new attributes.
      this.#scheduleStart();
      return;
    }
    if (name === 'src' || name === 'component') {
      this.#scheduleRestart();
      return;
    }
    if (this.#restartQueued) {
      // The restart reads every attribute once the whole update has been applied.
      return;
    }
    if (name === 'island-key') {
      // Same module, new identity (e.g. the same island on another page): handoffs must match the new key.
      this.#instance.rekey(this.islandKey);
      return;
    }
    let props: unknown;
    try {
      props = parseProps(newValue);
    } catch (error) {
      console.error(`[BlazorIslands] Island '${this.#instance.label}' received props that are not valid JSON.`, error);
      return;
    }
    if (!this.#instance.setProps(props)) {
      this.#stop();
      this.#start();
    }
  }

  showContainer(container: HTMLElement): void {
    if (this.attach) {
      return;
    }
    if (this.shadowMode === 'none') {
      if (container !== this) {
        this.replaceChildren(container);
      } else {
        this.replaceChildren();
      }
      return;
    }
    const shadow = this.#ensureShadow();
    shadow.replaceChildren(...this.#links(), container);
  }

  showFallback(): void {
    if (this.shadowMode !== 'none' && !this.attach) {
      this.#slot ??= document.createElement('slot');
      this.#ensureShadow().replaceChildren(...this.#links(), this.#slot);
    }
  }

  /**
   * `styles` stylesheets as `<link>` elements inside the shadow root: same-origin, so a `style-src 'self'` policy allows
   * them without a nonce; fingerprinted and immutable-cached like any static asset; scoped to the island, since shadow
   * roots don't inherit page CSS. The browser downloads each URL once however many islands link it.
   */
  #links(): HTMLLinkElement[] {
    if (this.#styleLinks) {
      return this.#styleLinks;
    }
    const urls = (this.getAttribute('styles') ?? '').split(/\s+/).filter(Boolean);
    this.#styleLinks = urls.map((url) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      return link;
    });
    const loaded = this.#styleLinks.map((link) => new Promise<void>((resolve) => {
      link.addEventListener('load', () => resolve(), { once: true });
      link.addEventListener('error', () => resolve(), { once: true });
    }));
    this.#stylesLoaded = Promise.all(loaded).then(() => undefined);
    return this.#styleLinks;
  }

  stylesReady(): Promise<void> {
    if (this.shadowMode === 'none' || this.attach) {
      return Promise.resolve();
    }
    this.#links();
    return this.#stylesLoaded ?? Promise.resolve();
  }

  #replaceStyles(): void {
    const old = this.#styleLinks ?? [];
    this.#styleLinks = undefined;
    if (!this.#shadow || this.shadowMode === 'none' || this.attach) {
      return;
    }
    const next = this.#links();
    const first = old.find((l) => l.parentNode === this.#shadow) ?? this.#shadow.firstChild;
    for (const link of next) {
      this.#shadow.insertBefore(link, first);
    }
    for (const link of old) {
      link.remove();
    }
  }

  /** Called by the Razor component (through BlazorIslands.connect) once an interactive renderer owns it. */
  islandConnect(ref: DotNetObjectLike | null): void {
    this.#pendingDotNet = ref;
    this.#instance?.connect(ref);
  }

  /** Called by the Razor component (through BlazorIslands.invoke) for InvokeJSAsync. */
  islandInvoke(method: string, args: unknown[]): Promise<unknown> {
    if (!this.#instance) {
      return Promise.reject(new Error(`No JS instance is mounted on this element (state: ${this.islandState}).`));
    }
    return this.#instance.invoke(method, args);
  }

  /** True when the last mount attempt failed and the fallback is showing. */
  get islandFailed(): boolean {
    return this.#failed;
  }

  setState(state: IslandState, on: boolean): void {
    if (state === 'error') {
      this.#failed = on;
    }
    const states = this.#internals?.states;
    if (!states) {
      return;
    }
    try {
      if (on) {
        states.add(state);
      } else {
        states.delete(state);
      }
    } catch {
      // CustomStateSet unavailable.
    }
  }

  #ensureShadow(): ShadowRoot {
    if (!this.#shadow) {
      this.#shadow = this.attachShadow({ mode: this.shadowMode === 'closed' ? 'closed' : 'open' });
      const sheet = getHostSheet();
      if (sheet) {
        this.#shadow.adoptedStyleSheets = [sheet];
      }
    }
    return this.#shadow;
  }

  #start(): void {
    const src = this.getAttribute('src');
    if (!src) {
      return;
    }
    let props: unknown;
    try {
      props = parseProps(this.getAttribute('props'));
    } catch (error) {
      console.error(`[BlazorIslands] Island '${src}' has props that are not valid JSON.`, error);
      this.setState('error', true);
      return;
    }
    this.setState('error', false);

    const orphan = takeOrphan(this.islandKey);
    // Matched by key (page + logical module) and component, not src: one module can resolve to different URLs on the
    // server prerender and in WebAssembly.
    if (orphan && orphan.component === this.getAttribute('component')) {
      this.#instance = orphan;
      orphan.adopt(this, props);
      if (this.#pendingDotNet) {
        orphan.connect(this.#pendingDotNet);
      }
      return;
    }

    const instance = new IslandInstance(this, src, this.getAttribute('component'), props, this.islandKey, this.shadowMode === 'none');
    this.#instance = instance;
    if (this.#pendingDotNet) {
      instance.connect(this.#pendingDotNet);
    }
    void instance.start().then(() => {
      if (instance.state === 'error' && this.#instance === instance) {
        // Let a later attribute change or reconnect retry.
        this.#instance = undefined;
      }
    });
  }

  #stop(): void {
    const instance = this.#instance;
    this.#instance = undefined;
    instance?.dispose();
    this.setState('error', false);
  }
}

export const elementName = 'blazor-island';

/** Defines `<blazor-island>` if it is not defined yet. Safe to call any number of times, from any copy of the runtime. */
export function defineIslandElement(registry: CustomElementRegistry | undefined = globalThis.customElements): void {
  if (registry && !registry.get(elementName)) {
    registry.define(elementName, BlazorIslandElement);
  }
}

/** Identity helper that gives a plain-module island full type inference for its props. */
export function defineIsland<P>(definition: IslandDefinition<P>): IslandDefinition<P> {
  return definition;
}

/** Identity helper for a bundle's `islands` export. */
export function defineIslands<T extends Record<string, IslandDefinition<any>>>(islands: T): T {
  return islands;
}

/**
 * The one call that says whether islands are healthy. Checks the invariants the matrix tests enforce:
 * - every `<blazor-island>` in the document is mounted, loading or (with a fallback) failed, and backs exactly one instance;
 * - no instance is mounted without an element in the document (leak) or on two elements (double mount);
 * - no key was mounted twice without an unmount in between (double mount across a handoff);
 * - the mounted counter matches the live set.
 */
export function inspect(): IslandsReport {
  const runtime = getRuntime();
  const problems: string[] = [];
  const elements = [...document.querySelectorAll(elementName)] as BlazorIslandElement[];
  const instances = [...runtime.live].map((i) => i.snapshot());

  const byInstance = new Map<number, number>();
  for (const el of elements) {
    if (el.islandId !== undefined) {
      byInstance.set(el.islandId, (byInstance.get(el.islandId) ?? 0) + 1);
    }
  }
  for (const [id, count] of byInstance) {
    if (count > 1) {
      problems.push(`Instance ${id} is attached to ${count} elements.`);
    }
  }
  for (const instance of runtime.live) {
    if (instance.state === 'mounted' && !instance.orphaned && !instance.host.element.isConnected) {
      problems.push(`Leak: ${instance.label} (#${instance.id}) is mounted but its element is not in the document.`);
    }
  }
  // Double mount: more live (non-orphaned) instances for a key than elements carrying that key.
  const liveByKey = new Map<string, number>();
  for (const instance of runtime.live) {
    if (!instance.orphaned) {
      liveByKey.set(instance.key, (liveByKey.get(instance.key) ?? 0) + 1);
    }
  }
  for (const [key, count] of liveByKey) {
    const elementsWithKey = elements.filter((el) => el.islandKey === key).length;
    if (count > elementsWithKey) {
      problems.push(`Double mount: ${key} has ${count} live instance(s) for ${elementsWithKey} element(s).`);
    }
  }
  const actuallyMounted = [...runtime.live].filter((i) => i.state === 'mounted').length;
  if (actuallyMounted !== runtime.stats.mounted) {
    problems.push(`Bookkeeping: stats.mounted=${runtime.stats.mounted} but ${actuallyMounted} instances are mounted.`);
  }
  for (const el of elements) {
    const outer = el.parentElement?.closest(elementName);
    if (outer && outer.getAttribute('shadow') === 'none') {
      problems.push(`Nested island: ${el.islandKey} is inside light-DOM island ${(outer as BlazorIslandElement).islandKey}.`);
    }
  }
  const unresolved = elements.filter((el) => el.getAttribute('src') && el.islandState === 'idle' && !el.islandFailed);
  for (const el of unresolved) {
    problems.push(`Element ${el.id ? `#${el.id}` : el.islandKey} is in the document but has no instance.`);
  }

  return {
    ok: problems.length === 0,
    problems,
    elements: elements.length,
    mounted: actuallyMounted,
    loading: [...runtime.live].filter((i) => i.state === 'loading').length,
    orphaned: [...runtime.orphans.values()].reduce((n, l) => n + l.length, 0),
    errors: elements.filter((el) => el.islandFailed).length,
    stats: { ...runtime.stats },
    instances,
  };
}
