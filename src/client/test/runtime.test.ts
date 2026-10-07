import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BlazorIslandElement,
  defineIslandElement,
  getRuntime,
  notifyPageUpdate,
  resolveDefinition,
  setModuleLoader,
  type IslandContext,
  type IslandDefinition,
  type IslandLifecycleDetail,
} from '../src/index';

// These tests drive the element through the DOM operations Blazor itself performs: element creation and insertion,
// attribute changes on a kept element (enhanced navigation / streaming merge), removal, and same-task moves.

type Recorder = { calls: string[]; contexts: IslandContext<any>[] };

function recordingIsland(rec: Recorder, opts: { withUpdate?: boolean; cleanup?: boolean } = {}): IslandDefinition<any> {
  const def: IslandDefinition<any> = {
    mount(ctx) {
      rec.calls.push(`mount:${JSON.stringify(ctx.props ?? null)}`);
      rec.contexts.push(ctx);
      const p = document.createElement('p');
      p.textContent = `mounted ${JSON.stringify(ctx.props ?? null)}`;
      ctx.root.append(p);
      return opts.cleanup ? () => rec.calls.push('cleanup') : undefined;
    },
    unmount() {
      rec.calls.push('unmount');
    },
  };
  if (opts.withUpdate !== false) {
    def.update = (props, ctx) => {
      rec.calls.push(`update:${JSON.stringify(props ?? null)}`);
      ctx.root.querySelector('p')!.textContent = `updated ${JSON.stringify(props ?? null)}`;
    };
  }
  return def;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

async function settle() {
  for (let i = 0; i < 5; i++) {
    await tick();
  }
}

/** Waits past the handoff window, after which a removed element's instance is unmounted for good. */
async function settleRemoval() {
  await new Promise<void>((r) => setTimeout(r, getRuntime().handoffWindowMs + 20));
  await settle();
}

function makeIsland(attrs: Record<string, string>): BlazorIslandElement {
  const el = document.createElement('blazor-island') as BlazorIslandElement;
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

let modules: Record<string, unknown>;
let loads: string[];
let events: IslandLifecycleDetail[];
const onLifecycle = (e: Event) => events.push((e as CustomEvent<IslandLifecycleDetail>).detail);

beforeEach(() => {
  defineIslandElement();
  modules = {};
  loads = [];
  events = [];
  setModuleLoader(async (url) => {
    loads.push(url);
    const key = new URL(url).pathname.replace(/^\//, '');
    if (!(key in modules)) {
      throw new Error(`404 ${key}`);
    }
    const m = modules[key];
    return typeof m === 'function' ? await (m as () => unknown)() : m;
  });
  document.addEventListener('blazor-islands:lifecycle', onLifecycle);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  document.body.replaceChildren();
  await settleRemoval();
  document.removeEventListener('blazor-islands:lifecycle', onLifecycle);
  vi.restoreAllMocks();
});

describe('<blazor-island> lifecycle', () => {
  it('mounts the module into an open shadow root with parsed props', async () => {
    const rec: Recorder = { calls: [], contexts: [] };
    modules['a.js'] = recordingIsland(rec);
    const el = makeIsland({ src: 'a.js', props: '{"n":1}' });
    document.body.append(el);
    await settle();

    expect(rec.calls).toEqual(['mount:{"n":1}']);
    expect(el.shadowRoot).not.toBeNull();
    expect(el.shadowRoot!.querySelector('.island-root')!.textContent).toBe('mounted {"n":1}');
    expect(el.islandState).toBe('mounted');
    expect(events.map((e) => e.type)).toEqual(['mount']);
  });

  it('shows the light-DOM fallback through a slot until the module arrives', async () => {
    let release!: (m: unknown) => void;
    const rec: Recorder = { calls: [], contexts: [] };
    modules['slow.js'] = () => new Promise((r) => { release = r; });
    const el = makeIsland({ src: 'slow.js' });
    el.innerHTML = '<p class="fallback">Loading</p>';
    document.body.append(el);
    await settle();

    expect(el.islandState).toBe('loading');
    expect(el.shadowRoot!.querySelector('slot')).not.toBeNull();

    release(recordingIsland(rec));
    await settle();
    expect(el.islandState).toBe('mounted');
    expect(el.shadowRoot!.querySelector('slot')).toBeNull();
    expect(el.querySelector('.fallback')).not.toBeNull();
  });

  it('a props change on a kept element calls update with the same instance', async () => {
    const rec: Recorder = { calls: [], contexts: [] };
    modules['a.js'] = recordingIsland(rec);
    const el = makeIsland({ src: 'a.js', props: '{"n":1}' });
    document.body.append(el);
    await settle();
    const id = el.islandId;

    el.setAttribute('props', '{"n":2}');
    await settle();

    expect(rec.calls).toEqual(['mount:{"n":1}', 'update:{"n":2}']);
    expect(el.islandId).toBe(id);
    expect(rec.contexts[0]!.props).toEqual({ n: 2 });
  });

  it('remounts on props change when the module has no update', async () => {
    const rec: Recorder = { calls: [], contexts: [] };
    modules['a.js'] = recordingIsland(rec, { withUpdate: false });
    const el = makeIsland({ src: 'a.js', props: '{"n":1}' });
    document.body.append(el);
    await settle();
    const id = el.islandId;

    el.setAttribute('props', '{"n":2}');
    await settle();

    expect(rec.calls).toEqual(['mount:{"n":1}', 'unmount', 'mount:{"n":2}']);
    expect(el.islandId).not.toBe(id);
  });

  it('a src change unmounts the old module and mounts the new one', async () => {
    const a: Recorder = { calls: [], contexts: [] };
    const b: Recorder = { calls: [], contexts: [] };
    modules['a.js'] = recordingIsland(a);
    modules['b.js'] = recordingIsland(b);
    const el = makeIsland({ src: 'a.js' });
    document.body.append(el);
    await settle();

    el.setAttribute('src', 'b.js');
    await settle();

    expect(a.calls).toEqual(['mount:null', 'unmount']);
    expect(b.calls).toEqual(['mount:null']);
    expect(el.shadowRoot!.querySelector('.island-root')!.textContent).toBe('mounted null');
  });

  it('removal unmounts, aborts the signal and runs dispose callbacks in reverse', async () => {
    const order: string[] = [];
    let signal!: AbortSignal;
    modules['a.js'] = {
      mount(ctx: IslandContext) {
        signal = ctx.signal;
        ctx.onDispose(() => order.push('first'));
        ctx.onDispose(() => order.push('second'));
        return () => order.push('returned');
      },
      unmount() {
        order.push('unmount');
      },
    };
    const el = makeIsland({ src: 'a.js' });
    document.body.append(el);
    await settle();
    el.remove();
    await settleRemoval();

    expect(signal.aborted).toBe(true);
    expect(order).toEqual(['unmount', 'returned', 'second', 'first']);
    expect(getRuntime().live.size).toBe(0);
  });

  it('listeners registered with ctx.signal are removed on unmount', async () => {
    let hits = 0;
    modules['a.js'] = {
      mount(ctx: IslandContext) {
        window.addEventListener('test-ping', () => hits++, { signal: ctx.signal });
      },
    };
    const el = makeIsland({ src: 'a.js' });
    document.body.append(el);
    await settle();
    window.dispatchEvent(new Event('test-ping'));
    el.remove();
    await settleRemoval();
    window.dispatchEvent(new Event('test-ping'));
    expect(hits).toBe(1);
  });

  it('a same-task move (disconnect + reconnect) keeps the instance', async () => {
    const rec: Recorder = { calls: [], contexts: [] };
    modules['a.js'] = recordingIsland(rec);
    const first = document.createElement('div');
    const second = document.createElement('div');
    document.body.append(first, second);
    const el = makeIsland({ src: 'a.js' });
    first.append(el);
    await settle();
    const id = el.islandId;

    second.append(el);
    await settle();

    expect(rec.calls).toEqual(['mount:null']);
    expect(el.islandId).toBe(id);
  });

  it('removal while the module is loading never mounts', async () => {
    let release!: (m: unknown) => void;
    const rec: Recorder = { calls: [], contexts: [] };
    modules['slow.js'] = () => new Promise((r) => { release = r; });
    const el = makeIsland({ src: 'slow.js' });
    document.body.append(el);
    await settle();
    el.remove();
    await settleRemoval();
    release(recordingIsland(rec));
    await settle();

    expect(rec.calls).toEqual([]);
    expect(events.filter((e) => e.type === 'mount')).toEqual([]);
  });

  it('removal during an async mount tears down what the mount set up', async () => {
    let finishMount!: () => void;
    const order: string[] = [];
    modules['a.js'] = {
      async mount(ctx: IslandContext) {
        order.push('mount-start');
        await new Promise<void>((r) => { finishMount = r; });
        order.push('mount-end');
        return () => order.push('cleanup');
      },
      unmount() {
        order.push('unmount');
      },
    };
    const el = makeIsland({ src: 'a.js' });
    document.body.append(el);
    await settle();
    el.remove();
    await settleRemoval();
    finishMount();
    await settle();

    expect(order).toEqual(['mount-start', 'mount-end', 'unmount', 'cleanup']);
    expect(getRuntime().stats.mounted).toBe(0);
  });

  it('a failing module keeps the fallback, sets :state(error) and recovers on a later src change', async () => {
    const rec: Recorder = { calls: [], contexts: [] };
    modules['ok.js'] = recordingIsland(rec);
    const el = makeIsland({ src: 'missing.js' });
    el.innerHTML = '<p>fallback</p>';
    document.body.append(el);
    await settle();

    expect(el.islandState).toBe('idle');
    expect(el.shadowRoot!.querySelector('slot')).not.toBeNull();
    expect(events.map((e) => e.type)).toEqual(['error']);

    el.setAttribute('src', 'ok.js');
    await settle();
    expect(rec.calls).toEqual(['mount:null']);
    expect(el.islandState).toBe('mounted');
  });

  it('invalid props JSON does not throw and does not mount', async () => {
    const rec: Recorder = { calls: [], contexts: [] };
    modules['a.js'] = recordingIsland(rec);
    const el = makeIsland({ src: 'a.js', props: '{not json' });
    document.body.append(el);
    await settle();
    expect(rec.calls).toEqual([]);
  });

  it('shadow="none" renders into the element itself', async () => {
    const rec: Recorder = { calls: [], contexts: [] };
    modules['a.js'] = recordingIsland(rec);
    const el = makeIsland({ src: 'a.js', shadow: 'none' });
    el.innerHTML = '<span>fallback</span>';
    document.body.append(el);
    await settle();
    expect(el.shadowRoot).toBeNull();
    expect(el.textContent).toBe('mounted null');
    el.remove();
    await settleRemoval();
    expect(el.textContent).toBe('');
  });

  it('ctx.emit dispatches a composed, bubbling blazor-island-event', async () => {
    let emit!: IslandContext['emit'];
    modules['a.js'] = { mount(ctx: IslandContext) { emit = ctx.emit; } };
    const el = makeIsland({ src: 'a.js' });
    document.body.append(el);
    await settle();
    const received: unknown[] = [];
    document.body.addEventListener('blazor-island-event', (e) => received.push((e as CustomEvent).detail));
    emit('saved', { id: 7 });
    emit('ping');
    expect(received).toEqual([{ name: 'saved', detail: { id: 7 } }, { name: 'ping', detail: null }]);
  });

  it('page updates reach mounted islands only', async () => {
    let updates = 0;
    modules['a.js'] = { mount(ctx: IslandContext) { ctx.onPageUpdate(() => updates++); } };
    const el = makeIsland({ src: 'a.js' });
    document.body.append(el);
    await settle();
    notifyPageUpdate();
    document.dispatchEvent(new CustomEvent('blazor-islands:page-update'));
    el.remove();
    await settleRemoval();
    notifyPageUpdate();
    expect(updates).toBe(2);
  });

  it('defineIslandElement is idempotent', () => {
    defineIslandElement();
    defineIslandElement();
    expect(customElements.get('blazor-island')).toBe(BlazorIslandElement);
  });

  it('a kept element whose src, island-key and props all change restarts once with all of the new values', async () => {
    const a: Recorder = { calls: [], contexts: [] };
    const b: Recorder = { calls: [], contexts: [] };
    modules['a.js'] = { default: recordingIsland(a) };
    modules['b.js'] = { default: recordingIsland(b) };
    const el = makeIsland({ src: 'a.js', 'island-key': 'page-a|card', props: '{"n":1}' });
    document.body.append(el);
    await settle();

    // Blazor's DOM merge applies a reused element's attributes one by one, in render-tree order.
    el.setAttribute('src', 'b.js');
    el.setAttribute('island-key', 'page-b|card');
    el.setAttribute('props', '{"n":2}');
    await settle();

    expect(a.calls).toEqual(['mount:{"n":1}', 'unmount']);
    expect(b.calls).toEqual(['mount:{"n":2}']);
    const live = [...getRuntime().live];
    expect(live.map((i) => i.key)).toEqual(['page-b|card']);
  });

  it('a new island-key on a kept element re-keys the mounted island instead of remounting it', async () => {
    const rec: Recorder = { calls: [], contexts: [] };
    modules['m.js'] = { default: recordingIsland(rec) };
    const el = makeIsland({ src: 'm.js', 'island-key': 'one|x' });
    document.body.append(el);
    await settle();
    el.setAttribute('island-key', 'two|x');
    await settle();
    expect(rec.calls).toEqual(['mount:null']);
    expect([...getRuntime().live].map((i) => i.key)).toEqual(['two|x']);
  });

  it('styles are linked inside the shadow root and the island mounts only once they have loaded', async () => {
    const rec: Recorder = { calls: [], contexts: [] };
    modules['m.js'] = { default: recordingIsland(rec) };
    const el = makeIsland({ src: 'm.js', styles: 'css/a.css css/b.css' });
    el.innerHTML = '<p>fallback</p>';
    document.body.append(el);
    await settle();

    const links = [...el.shadowRoot!.querySelectorAll('link')];
    expect(links.map((l) => [l.rel, l.getAttribute('href')])).toEqual([['stylesheet', 'css/a.css'], ['stylesheet', 'css/b.css']]);
    expect(rec.calls).toEqual([]);
    expect(el.shadowRoot!.querySelector('slot')).not.toBeNull();

    links[0]!.dispatchEvent(new Event('load'));
    await settle();
    expect(rec.calls).toEqual([]);
    // A stylesheet that fails to load must not keep the island on its fallback forever.
    links[1]!.dispatchEvent(new Event('error'));
    await settle();
    expect(rec.calls).toEqual(['mount:null']);
    // The links stay in front of the island's container.
    expect([...el.shadowRoot!.children].map((c) => c.tagName)).toEqual(['LINK', 'LINK', 'DIV']);
  });

  it('a handoff while waiting for stylesheets mounts once the new element\'s stylesheets load', async () => {
    const rec: Recorder = { calls: [], contexts: [] };
    modules['m.js'] = { default: recordingIsland(rec) };
    const first = makeIsland({ src: 'm.js', styles: 'css/a.css', 'island-key': 'p|card' });
    document.body.append(first);
    await settle();
    expect(rec.calls).toEqual([]);

    // The interactive renderer replaces the prerendered element in one task; the old element's load is cancelled.
    const second = makeIsland({ src: 'm.js', styles: 'css/a.css', 'island-key': 'p|card' });
    first.replaceWith(second);
    await settle();
    expect(rec.calls).toEqual([]);

    second.shadowRoot!.querySelector('link')!.dispatchEvent(new Event('load'));
    await settle();
    expect(rec.calls).toEqual(['mount:null']);
    expect(second.shadowRoot!.querySelector('.island-root p')!.textContent).toBe('mounted null');
    expect(getRuntime().stats.handoffs).toBeGreaterThan(0);
  });
});

describe('bundles', () => {
  it('islands from one bundle share one import', async () => {
    const a: Recorder = { calls: [], contexts: [] };
    const b: Recorder = { calls: [], contexts: [] };
    modules['bundle.js'] = { islands: { A: recordingIsland(a), B: recordingIsland(b) } };
    document.body.append(
      makeIsland({ src: 'bundle.js', component: 'A' }),
      makeIsland({ src: 'bundle.js', component: 'B' }),
      makeIsland({ src: 'bundle.js', component: 'A' }),
    );
    await settle();
    expect(loads.filter((u) => u.endsWith('/bundle.js'))).toHaveLength(1);
    expect(a.calls).toHaveLength(2);
    expect(b.calls).toHaveLength(1);
  });

  it('a component change remounts with the new component', async () => {
    const a: Recorder = { calls: [], contexts: [] };
    const b: Recorder = { calls: [], contexts: [] };
    modules['bundle.js'] = { islands: { A: recordingIsland(a), B: recordingIsland(b) } };
    const el = makeIsland({ src: 'bundle.js', component: 'A' });
    document.body.append(el);
    await settle();
    el.setAttribute('component', 'B');
    await settle();
    expect(a.calls).toEqual(['mount:null', 'unmount']);
    expect(b.calls).toEqual(['mount:null']);
  });

  it('a failed import is retried by the next island', async () => {
    let attempts = 0;
    const rec: Recorder = { calls: [], contexts: [] };
    modules['flaky.js'] = () => {
      attempts++;
      if (attempts === 1) {
        throw new Error('network');
      }
      return recordingIsland(rec);
    };
    const first = makeIsland({ src: 'flaky.js' });
    document.body.append(first);
    await settle();
    expect(first.islandState).toBe('idle');
    document.body.append(makeIsland({ src: 'flaky.js' }));
    await settle();
    expect(attempts).toBe(2);
    expect(rec.calls).toEqual(['mount:null']);
  });
});

describe('resolveDefinition', () => {
  const def = { mount() {} };

  it('accepts named exports, a default export, an islands map, a default map and named components', () => {
    expect(resolveDefinition(def, 'm.js', null)).toBe(def);
    expect(resolveDefinition({ default: def }, 'm.js', null)).toBe(def);
    expect(resolveDefinition({ islands: { X: def } }, 'b.js', 'X')).toBe(def);
    expect(resolveDefinition({ default: { X: def } }, 'b.js', 'X')).toBe(def);
    expect(resolveDefinition({ X: def }, 'b.js', 'X')).toBe(def);
  });

  it('explains what is missing', () => {
    expect(() => resolveDefinition({}, 'm.js', null)).toThrow(/must export a mount\(ctx\)/);
    expect(() => resolveDefinition({ islands: { A: def, B: def } }, 'b.js', 'C')).toThrow(/no island named 'C'. Available: A, B/);
  });
});
