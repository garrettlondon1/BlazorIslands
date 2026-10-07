// Licensed under the MIT license.

import { BlazorIslandElement, defineIslandElement, getRuntime, inspect, loadModuleOnce, notifyPageUpdate } from './runtime.js';
import type { DotNetObjectLike, IslandLifecycleDetail, IslandsReport } from './types.js';

export * from './types.js';
export {
  BlazorIslandElement,
  defineIsland,
  defineIslands,
  defineIslandElement,
  elementName,
  getRuntime,
  inspect,
  loadModuleOnce,
  notifyPageUpdate,
  resolveDefinition,
  setModuleLoader,
  type IslandHost,
  type IslandRuntime,
} from './runtime.js';
export { islandFetch, islandJson, IslandHttpError, readConfig } from './http.js';

/** Dispatched on `document` by the Blazor JS initializer after each enhanced update. */
export const pageUpdateEventName = 'blazor-islands:page-update';

/** Dispatched on `document` by the Blazor JS initializer for Blazor's own lifecycle (see `blazorEvents()`). */
export const blazorEventName = 'blazor-islands:blazor';

export interface BlazorLifecycleEvent {
  type: 'web-started' | 'server-started' | 'webassembly-started' | 'circuit-opened' | 'circuit-closed' | 'circuit-down' | 'circuit-up' | 'enhanced-load';
  at: number;
}

const startedKey = Symbol.for('blazor-islands.started');
const blazorEventsKey = Symbol.for('blazor-islands.blazor-events');

/** Blazor lifecycle as observed by the JS initializer, oldest first: boot, circuits, WebAssembly, connection drops. */
export function blazorEvents(): BlazorLifecycleEvent[] {
  const g = globalThis as { [blazorEventsKey]?: BlazorLifecycleEvent[] };
  return (g[blazorEventsKey] ??= []);
}

/** The island lifecycle history, oldest first. */
export function history(): IslandLifecycleDetail[] {
  return [...getRuntime().history];
}

/**
 * Imports every bundle named by `<IslandBundle>` (`<meta name="blazor-islands-bundle">`) without waiting for an island
 * to ask for it, so its code is parsed by the time the first island mounts. Failures are left for the island to report.
 */
export function preloadBundles(root: ParentNode = document): void {
  for (const meta of root.querySelectorAll('meta[name="blazor-islands-bundle"]')) {
    const src = meta.getAttribute('content');
    if (src) {
      loadModuleOnce(src).catch(() => undefined);
    }
  }
}

/**
 * `window.BlazorIslands`: the dev-tools surface (`BlazorIslands.print()` in the console) and the entry points .NET calls
 * through IJSRuntime for JS components.
 */
export interface IslandsDevTools {
  /** Hands a component's DotNetObjectReference to its JS instance. Called by JSScope once interactive. */
  connect(element: Element, ref: DotNetObjectLike | null): void;
  /** Calls a method on a component's JS instance. Called by JSComponent.InvokeJSAsync. */
  invoke(element: Element, method: string, args?: unknown[]): Promise<unknown>;
  inspect(): IslandsReport;
  history(): IslandLifecycleDetail[];
  blazor(): BlazorLifecycleEvent[];
  /** Prints a table of every island and any problems. */
  print(): IslandsReport;
}

function installDevTools(): void {
  const host = (element: Element): BlazorIslandElement => {
    if (!(element instanceof BlazorIslandElement)) {
      throw new Error('BlazorIslands: the element is not a <blazor-island> host.');
    }
    return element;
  };
  const tools: IslandsDevTools = {
    // Tolerant: a component may be connected after its element was replaced or removed.
    connect: (element, ref) => {
      if (element instanceof BlazorIslandElement) {
        element.islandConnect(ref);
      }
    },
    invoke: (element, method, args = []) => host(element).islandInvoke(method, args),
    inspect,
    history,
    blazor: blazorEvents,
    print() {
      const report = inspect();
      console.table(report.instances);
      if (report.ok) {
        console.info(`[BlazorIslands] OK: ${report.mounted} mounted, ${report.loading} loading, ${report.errors} failed, ${report.stats.handoffs} handoff(s).`);
      } else {
        console.warn('[BlazorIslands] Problems:\n' + report.problems.join('\n'));
      }
      return report;
    },
  };
  // Not `window.Blazor`: that belongs to the framework.
  (globalThis as { BlazorIslands?: IslandsDevTools }).BlazorIslands = tools;
}

/**
 * JS component hosts must not affect layout. A constructable stylesheet is CSP-safe: no style element, no style attribute.
 */
function installStyles(): void {
  if (typeof CSSStyleSheet === 'undefined' || !('replaceSync' in CSSStyleSheet.prototype) || !('adoptedStyleSheets' in document)) {
    return;
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync('blazor-island[attach]{display:contents}');
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

/**
 * Starts the runtime: defines `<blazor-island>`, listens for Blazor page updates and preloads every bundle named by
 * `<IslandBundle>`. Runs on import, independent of Blazor: islands mount as soon as their module arrives, whether
 * blazor.web.js has booted yet or not, and Blazor never waits for island JavaScript.
 */
export function start(): void {
  const g = globalThis as { [startedKey]?: boolean };
  if (g[startedKey] || typeof document === 'undefined') {
    return;
  }
  g[startedKey] = true;
  getRuntime();
  document.addEventListener(pageUpdateEventName, () => {
    preloadBundles();
    notifyPageUpdate();
  });
  document.addEventListener(blazorEventName, (e) => {
    const events = blazorEvents();
    events.push({ type: (e as CustomEvent<{ type: BlazorLifecycleEvent['type'] }>).detail.type, at: performance.now() });
    // One 'enhanced-load' per navigation: keep it bounded like the island history.
    if (events.length > getRuntime().historyLimit) {
      events.splice(0, events.length - getRuntime().historyLimit);
    }
  });
  installDevTools();
  installStyles();
  preloadBundles();
  defineIslandElement();
}

start();
