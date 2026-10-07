import type { CDPSession, Page, WebSocket } from '@playwright/test';
import { test, expect, waitForIsland } from '../fixtures';

/**
 * What islands cost at runtime, measured in Chromium:
 * - leaks: DOM nodes, listeners, island elements, instances, shadow roots, observers and abort controllers stay flat
 *   across repeated tours of every render mode (static, streaming, Server, WebAssembly, Auto, React/Preact bundles);
 * - circuit: islands send nothing over the Blazor Server circuit unless the app asked (OnEvent, invokeDotNet), .NET
 *   connects each JS component exactly once, and nothing feeds back into a render loop;
 * - CPU: script time spent in the island runtime itself versus everything else on the page.
 *
 * Object counts come from WeakRefs taken as objects are created, not Runtime.queryObjects: a heap walk stalls once the
 * .NET WebAssembly runtime is loaded. Results are attached to each test and printed as `[profile] ...` lines.
 */

const verbose = !!process.env.PROFILE_VERBOSE;

/** Installed before any page script: remembers every object of interest in a WeakRef. */
function installTracking() {
  const w = window as unknown as { __track: Record<string, WeakRef<object>[]> };
  w.__track = { islandElements: [], islandInstances: [], shadowRoots: [], mutationObservers: [], abortControllers: [] };
  const remember = (kind: string, o: object) => { w.__track[kind].push(new WeakRef(o)); };

  const NativeMO = window.MutationObserver;
  window.MutationObserver = class extends NativeMO {
    constructor(cb: MutationCallback) { super(cb); remember('mutationObservers', this); }
  };
  const NativeAC = window.AbortController;
  window.AbortController = class extends NativeAC {
    constructor() { super(); remember('abortControllers', this); }
  };
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init: ShadowRootInit) {
    const root = attachShadow.call(this, init);
    remember('shadowRoots', root);
    return root;
  };
  const define = customElements.define.bind(customElements);
  customElements.define = (name: string, ctor: CustomElementConstructor, options?: ElementDefinitionOptions) => {
    if (name === 'blazor-island') {
      const Tracked = class extends (ctor as unknown as typeof HTMLElement) {
        constructor() { super(); remember('islandElements', this); }
      };
      return define(name, Tracked as unknown as CustomElementConstructor, options);
    }
    return define(name, ctor, options);
  };
  // Instances: the runtime keeps every live one in a Set; remember each as it is added.
  const runtimeKey = Symbol.for('blazor-islands.runtime');
  const hook = () => {
    const r = (globalThis as unknown as Record<symbol, { live: Set<object> } | undefined>)[runtimeKey];
    if (!r) {
      return false;
    }
    const add = r.live.add.bind(r.live);
    r.live.add = (o: object) => { remember('islandInstances', o); return add(o); };
    return true;
  };
  if (!hook()) {
    const timer = setInterval(() => { if (hook()) clearInterval(timer); }, 0);
  }
}

async function openCdp(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

/** Reads a value through CDP on the main world. */
async function cdpValue<T>(cdp: CDPSession, expression: string): Promise<T> {
  const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 10_000 });
  if (exceptionDetails) {
    throw new Error(`${expression}: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
  }
  return result.value as T;
}

interface Snapshot {
  nodes: number;
  listeners: number;
  heapMb: number;
  islandElements: number;
  detachedIslandElements: number;
  islandInstances: number;
  shadowRoots: number;
  mutationObservers: number;
  abortControllers: number;
  islandElementsInDocument: number;
  live: number;
  orphans: number;
  modules: number;
  history: number;
  blazorEvents: number;
  adoptedSheets: number;
}

async function collect(page: Page, cdp: CDPSession) {
  for (let i = 0; i < 3; i++) {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(100);
  }
}

async function snapshot(page: Page, cdp: CDPSession): Promise<Snapshot> {
  // Orphaned instances wait at most one task; give timers and microtasks a moment, then collect.
  await page.waitForTimeout(300);
  await collect(page, cdp);
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const state = await cdpValue<Omit<Snapshot, 'nodes' | 'listeners' | 'heapMb'>>(cdp, `(() => {
    const r = globalThis[Symbol.for('blazor-islands.runtime')];
    const alive = (kind) => (window.__track[kind] = window.__track[kind].filter((ref) => ref.deref() !== undefined));
    return {
      islandElements: alive('islandElements').length,
      detachedIslandElements: alive('islandElements').filter((ref) => !ref.deref().isConnected).length,
      islandInstances: alive('islandInstances').length,
      shadowRoots: alive('shadowRoots').length,
      mutationObservers: alive('mutationObservers').length,
      abortControllers: alive('abortControllers').length,
      islandElementsInDocument: document.querySelectorAll('blazor-island').length,
      live: r.live.size,
      orphans: [...r.orphans.values()].reduce((n, l) => n + l.length, 0),
      modules: r.modules.size,
      history: r.history.length,
      blazorEvents: window.BlazorIslands.blazor().length,
      adoptedSheets: document.adoptedStyleSheets.length,
    };
  })()`);
  return {
    nodes: m.Nodes,
    listeners: m.JSEventListeners,
    heapMb: Math.round((m.JSHeapUsedSize / 1024 / 1024) * 100) / 100,
    ...state,
  };
}

/** Enhanced navigation (or the interactive router in global modes), waiting for Blazor to patch the page in. */
async function go(page: Page, path: string) {
  const before = await page.evaluate(() => (window as any).__pageUpdates as number);
  await page.evaluate((p) => (window as any).Blazor.navigateTo(p), path);
  await page.waitForFunction((b) => (window as any).__pageUpdates > b, before, { timeout: 30_000 });
}

/** One tour of the app: every render mode on the matrix, plus framework bundles, streaming and light DOM. */
const tour: Array<{ path: string; island: string; interactive?: boolean }> = [
  { path: 'm/static', island: 'probe-island' },
  { path: 'm/stream', island: 'probe-island' },
  { path: 'm/server', island: 'probe-island', interactive: true },
  { path: 'm/wasm', island: 'probe-island', interactive: true },
  { path: 'm/auto', island: 'probe-island', interactive: true },
  { path: 'm/server-np', island: 'probe-island', interactive: true },
  { path: 'static', island: 'static-counter' },
  { path: 'react', island: 'chart' },
  { path: 'react-app', island: 'cart-summary' },
  { path: 'preact-tsx', island: 'todo' },
  { path: 'shadow-none', island: 'light' },
  { path: 'interactive', island: 'interactive-counter' },
  { path: 'm', island: 'hub-island' },
];

async function visit(page: Page, step: (typeof tour)[number], clicks = true) {
  await go(page, step.path);
  await waitForIsland(page, step.island, 'mounted', 30_000);
  if (step.interactive && clicks) {
    await page.locator('#probe[data-interactive=true]').waitFor({ timeout: 30_000 });
    // Exercise the JS component and the island under the interactive renderer before leaving.
    await page.click('#widget-js-click');
    await page.click('#probe-increment');
  }
}

async function runTour(page: Page) {
  for (const step of tour) {
    const t0 = Date.now();
    await visit(page, step);
    if (verbose) {
      console.log(`[tour] ${step.path} ${Date.now() - t0}ms`);
    }
  }
}

/** Counts Blazor hub invocations by name in each direction. Blazor Server speaks MessagePack ("blazorpack"). */
class CircuitRecorder {
  sent = new Map<string, number>();
  received = new Map<string, number>();
  framesSent = 0;
  framesReceived = 0;
  private readonly names = [
    // Browser events reach .NET as BeginInvokeDotNetFromJS(DispatchEventAsync); JsClicked is the probe widget's own call.
    'DispatchEventAsync', 'JsClicked', 'BeginInvokeDotNetFromJS', 'EndInvokeJSFromDotNet', 'OnRenderCompleted', 'OnLocationChanged',
    'OnLocationChanging', 'UpdateRootComponents', 'ReceiveByteArray', 'JS.BeginInvokeJS', 'JS.RenderBatch',
    'JS.EndInvokeDotNet', 'BlazorIslands.connect', 'BlazorIslands.invoke',
  ];

  attach(page: Page) {
    page.on('websocket', (ws: WebSocket) => {
      if (!/_blazor/.test(ws.url())) {
        return;
      }
      ws.on('framesent', (f) => { this.framesSent++; this.count(this.sent, f.payload); });
      ws.on('framereceived', (f) => { this.framesReceived++; this.count(this.received, f.payload); });
    });
  }

  private count(into: Map<string, number>, payload: string | Buffer) {
    const text = typeof payload === 'string' ? payload : payload.toString('latin1');
    for (const name of this.names) {
      let at = text.indexOf(name);
      while (at >= 0) {
        // "JS.BeginInvokeJS" also contains "BeginInvokeJS"; names are distinct enough that substrings don't collide
        // except where intended (BlazorIslands.* travel inside JS.BeginInvokeJS).
        into.set(name, (into.get(name) ?? 0) + 1);
        at = text.indexOf(name, at + name.length);
      }
    }
  }

  reset() {
    this.sent.clear();
    this.received.clear();
    this.framesSent = 0;
    this.framesReceived = 0;
  }

  get summary() {
    return {
      framesSent: this.framesSent,
      framesReceived: this.framesReceived,
      sent: Object.fromEntries(this.sent),
      received: Object.fromEntries(this.received),
    };
  }
}

test.describe('runtime profile', () => {
  test.describe.configure({ mode: 'serial', timeout: 300_000 });

  test('retainers of detached island hosts (diagnostic)', async ({ page }, info) => {
    test.skip(!process.env.PROFILE_RETAINERS, 'Set PROFILE_RETAINERS=1 to walk heap retainers.');
    const target = process.env.PROFILE_RETAINERS_PAGE ?? 'm/server';
    await page.goto('/m');
    await waitForIsland(page, 'hub-island');
    const cdp = await openCdp(page);
    if (target === 'tour') {
      await runTour(page);
    } else {
      for (let i = 0; i < 2; i++) {
        await go(page, target);
        await waitForIsland(page, 'probe-island');
        await page.locator('#probe[data-interactive=true]').waitFor();
        await go(page, 'm');
        await waitForIsland(page, 'hub-island');
      }
    }
    await page.waitForTimeout(500);
    await collect(page, cdp);

    const chunks: string[] = [];
    cdp.on('HeapProfiler.addHeapSnapshotChunk', (e) => chunks.push(e.chunk));
    await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
    const snap = JSON.parse(chunks.join(''));
    const { node_fields: nf, edge_fields: ef, node_types: [nodeTypes], edge_types: [edgeTypes] } = snap.snapshot.meta;
    const N = nf.length;
    const E = ef.length;
    const nodes: number[] = snap.nodes;
    const edges: number[] = snap.edges;
    const strings: string[] = snap.strings;
    const nName = nf.indexOf('name');
    const nType = nf.indexOf('type');
    const nEdges = nf.indexOf('edge_count');
    const eType = ef.indexOf('type');
    const eName = ef.indexOf('name_or_index');
    const eTo = ef.indexOf('to_node');
    const count = nodes.length / N;
    const retainers: Array<Array<[number, number]>> = Array.from({ length: count }, () => []);
    let edge = 0;
    for (let n = 0; n < count; n++) {
      for (let k = 0; k < nodes[n * N + nEdges]; k++, edge += E) {
        const to = edges[edge + eTo] / N;
        if (edgeTypes[edges[edge + eType]] !== 'weak') {
          retainers[to].push([n, edge]);
        }
      }
    }
    const label = (n: number) => `${nodeTypes[nodes[n * N + nType]]}:${strings[nodes[n * N + nName]].slice(0, 90)}`;
    const edgeLabel = (e: number) => {
      const t = edgeTypes[edges[e + eType]];
      const v = edges[e + eName];
      return t === 'element' || t === 'hidden' ? `[${v}]` : `.${strings[v]}`;
    };
    const nDetached = nf.indexOf('detachedness');
    const targets = [...Array(count).keys()].filter((n) => strings[nodes[n * N + nName]].startsWith('<blazor-island') && (nDetached < 0 || nodes[n * N + nDetached] === 2));
    const paths: string[] = [];
    for (const start of targets.slice(0, 2)) {
      // BFS towards a root, preferring the shortest path.
      const prev = new Map<number, [number, number]>([[start, [-1, -1]]]);
      const queue = [start];
      let root = -1;
      while (queue.length && root < 0) {
        const n = queue.shift()!;
        for (const [from, e] of retainers[n]) {
          if (prev.has(from)) continue;
          prev.set(from, [n, e]);
          const name = strings[nodes[from * N + nName]];
          if (/^\(GC roots\)|^Window|^\(Global handles\)|^\(Document DOM trees\)/.test(name) || nodeTypes[nodes[from * N + nType]] === 'synthetic') {
            root = from;
            break;
          }
          queue.push(from);
        }
      }
      const path: string[] = [];
      for (let n = root; n >= 0 && n !== start;) {
        const [next, e] = prev.get(n)!;
        path.push(`${label(n)} ${edgeLabel(e)} ->`);
        n = next;
      }
      path.push(label(start));
      paths.push(path.slice(-25).join('\n  '));
    }
    const report = `${targets.length} detached island host(s)\n${paths.join('\n\n')}`;
    await info.attach('retainers.txt', { body: report, contentType: 'text/plain' });
    console.log('[profile] retainers\n' + report);
  });

  test('no DOM, listener, element or instance growth across repeated tours of every render mode', async ({ page }, info) => {
    await page.addInitScript(installTracking);
    await page.goto('/m');
    await waitForIsland(page, 'hub-island');
    const cdp = await openCdp(page);

    // Warm-up: downloads every module and boots WebAssembly once.
    await runTour(page);
    const warm = await snapshot(page, cdp);
    const rounds = Number(process.env.PROFILE_ROUNDS ?? 5);
    for (let i = 0; i < rounds; i++) {
      await runTour(page);
    }
    const after = await snapshot(page, cdp);

    const report = { rounds, navigationsPerRound: tour.length, warm, after };
    await info.attach('leaks.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    console.log('[profile] leaks', JSON.stringify(report));

    const health = await cdpValue<{ problems: string[]; mounted: number; loading: number }>(cdp, 'BlazorIslands.inspect()');
    expect(health.problems).toEqual([]);
    // Everything the island runtime owns is bounded by what is on screen now, not by how many pages were visited.
    expect(after.live).toBe(health.mounted + health.loading);
    expect(after.orphans).toBe(0);
    expect(after.modules).toBe(warm.modules);
    expect(after.adoptedSheets).toBe(warm.adoptedSheets);
    expect(after.history).toBeLessThanOrEqual(500);
    expect(after.blazorEvents).toBeLessThanOrEqual(500);
    expect(after.detachedIslandElements).toBe(0);
    expect(after.islandElements).toBe(after.islandElementsInDocument);
    expect(after.islandInstances).toBe(after.live);
    // Same page as the warm snapshot, so the same document size and the same number of live objects.
    expect(after.nodes).toBeLessThanOrEqual(warm.nodes);
    expect(after.listeners).toBeLessThanOrEqual(warm.listeners);
    expect(after.shadowRoots).toBeLessThanOrEqual(warm.shadowRoots);
    expect(after.mutationObservers).toBeLessThanOrEqual(warm.mutationObservers);
    expect(after.abortControllers).toBeLessThanOrEqual(warm.abortControllers);
  });

  test('islands never chatter on the circuit: idle, props updates, island clicks and JS component calls', async ({ page }, info) => {
    const circuit = new CircuitRecorder();
    circuit.attach(page);
    await page.goto('/m/server');
    await page.locator('#probe[data-interactive=true]').waitFor();
    await waitForIsland(page, 'probe-island');
    // Let the first render batches, acks and JS component connect finish.
    await page.waitForTimeout(1000);
    const boot = circuit.summary;
    expect(boot.received['BlazorIslands.connect'] ?? 0, 'one connect per JS component').toBe(1);

    const scenarios: Record<string, unknown> = { boot };
    const measure = async (name: string, action: () => Promise<void>) => {
      circuit.reset();
      await action();
      // Anything a feedback loop would produce shows up well within this window.
      await page.waitForTimeout(1500);
      scenarios[name] = circuit.summary;
      return circuit.summary;
    };

    const idle = await measure('idle 1.5s', async () => {});
    expect(Object.keys(idle.sent), 'nothing but pings while idle').toEqual([]);
    expect(Object.keys(idle.received)).toEqual([]);

    // .NET re-renders 5 times: island props and JS component parameters change, nothing goes back but render acks.
    const props = await measure('5 .NET-driven props updates', async () => {
      for (let i = 0; i < 5; i++) {
        await page.click('#probe-increment');
      }
      await expect.poll(() => page.evaluate(() => (document.getElementById('probe-island') as any).islandProps.count)).toBe(5);
    });
    expect(props.sent.DispatchEventAsync).toBe(5);
    expect(props.sent.JsClicked ?? 0).toBe(0);
    expect(props.received['BlazorIslands.connect'] ?? 0).toBe(0);
    expect(props.received['BlazorIslands.invoke'] ?? 0).toBe(0);

    // An island event with OnEvent: exactly one dispatch per emit.
    const emits = await measure('5 island emits with OnEvent', async () => {
      for (let i = 0; i < 5; i++) {
        await page.locator('#probe-island [data-testid=probe-click]').click();
      }
      await expect(page.locator('#probe-events')).toHaveText('Island events: 5');
    });
    expect(emits.sent.DispatchEventAsync).toBe(5);
    expect(emits.sent.JsClicked ?? 0).toBe(0);

    // A JS component calling .NET, which re-renders, which runs rendered(): one call each, no loop.
    const calls = await measure('5 JS->.NET calls that re-render', async () => {
      for (let i = 0; i < 5; i++) {
        await page.click('#widget-js-click');
      }
      await expect(page.locator('#widget-net-count')).toHaveText('.NET saw 5 JS click(s)');
    });
    expect(calls.sent.JsClicked).toBe(5);
    expect(calls.sent.DispatchEventAsync ?? 0).toBe(0);

    // .NET calling the JS component: one JS interop call each.
    const invokes = await measure('3 .NET->JS calls', async () => {
      for (let i = 0; i < 3; i++) {
        await page.click('#widget-call-js');
      }
      await expect(page.locator('#widget-js-answer')).toContainText('from .NET');
    });
    expect(invokes.received['BlazorIslands.invoke']).toBe(3);
    expect(invokes.sent.EndInvokeJSFromDotNet).toBe(3);


    await info.attach('circuit.json', { body: JSON.stringify(scenarios, null, 2), contentType: 'application/json' });
    console.log('[profile] circuit', JSON.stringify(scenarios));
  });

  test('island runtime CPU per tour', async ({ page }, info) => {
    await page.goto('/m');
    await waitForIsland(page, 'hub-island');
    const cdp = await openCdp(page);
    await runTour(page); // warm caches and WebAssembly

    const before = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
    await cdp.send('Profiler.start');
    const t0 = Date.now();
    await runTour(page);
    const wall = Date.now() - t0;
    const { profile } = await cdp.send('Profiler.stop');
    const after = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]));

    // Self time per script, from sample counts.
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const counts = new Map<number, number>();
    for (const id of profile.samples ?? []) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const total = profile.endTime - profile.startTime;
    const sampleMs = total / Math.max(1, profile.samples?.length ?? 1) / 1000;
    const byScript = new Map<string, number>();
    const byFunction = new Map<string, number>();
    for (const [id, n] of counts) {
      const node = byId.get(id)!;
      const url = node.callFrame.url;
      const script = url ? new URL(url, 'http://x').pathname.replace(/\.[a-z0-9]{8,12}\.(m?js)$/, '.$1') : `(${node.callFrame.functionName || 'program'})`;
      byScript.set(script, (byScript.get(script) ?? 0) + n * sampleMs);
      if (/blazor-islands|preact-adapter/.test(script)) {
        const fn = `${node.callFrame.functionName || '(anonymous)'} ${script}:${node.callFrame.lineNumber + 1}`;
        byFunction.set(fn, (byFunction.get(fn) ?? 0) + n * sampleMs);
      }
    }
    const top = (map: Map<string, number>, k: number) =>
      [...map].sort((a, b) => b[1] - a[1]).slice(0, k).map(([name, ms]) => ({ name, ms: Math.round(ms * 10) / 10 }));
    const islandsMs = [...byScript].filter(([s]) => /blazor-islands|preact-adapter/.test(s)).reduce((n, [, ms]) => n + ms, 0);
    const report = {
      navigations: tour.length,
      wallMs: wall,
      scriptMs: Math.round((after.ScriptDuration - before.ScriptDuration) * 1000),
      taskMs: Math.round((after.TaskDuration - before.TaskDuration) * 1000),
      layouts: after.LayoutCount - before.LayoutCount,
      styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount,
      islandRuntimeSelfMs: Math.round(islandsMs * 10) / 10,
      islandRuntimeMsPerNavigation: Math.round((islandsMs / tour.length) * 100) / 100,
      topScripts: top(byScript, 12),
      topIslandFunctions: top(byFunction, 12),
    };
    await info.attach('cpu.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    console.log('[profile] cpu', JSON.stringify(report));
    // The runtime's own work is a rounding error next to rendering a page: under 2ms per navigation.
    expect(report.islandRuntimeMsPerNavigation).toBeLessThan(2);
  });
});
