import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineIslandElement, getRuntime, inspect, setModuleLoader, type IslandContext, type IslandLifecycleDetail } from '../src/index';

// Reproduces what Blazor's interactive renderers do when a circuit or WebAssembly starts on a prerendered page:
// BrowserRenderer.updateComponent clears the prerendered DOM (emptyLogicalElement) and renders the same markup again,
// creating new elements. Without handoff every island would unmount and mount a second time.

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};
const pastWindow = () => new Promise((r) => setTimeout(r, getRuntime().handoffWindowMs + 20));

let events: IslandLifecycleDetail[];
const onLifecycle = (e: Event) => events.push((e as CustomEvent<IslandLifecycleDetail>).detail);
let mounts: number;
let unmounts: number;
let states: string[];

beforeEach(() => {
  defineIslandElement();
  events = [];
  mounts = 0;
  unmounts = 0;
  states = [];
  setModuleLoader(async () => ({
    mount(ctx: IslandContext<{ n?: number }>) {
      mounts++;
      const button = document.createElement('button');
      let clicks = 0;
      button.textContent = `clicks:${clicks} n:${ctx.props?.n ?? ''}`;
      button.addEventListener('click', () => { clicks++; button.textContent = `clicks:${clicks} n:${ctx.props?.n ?? ''}`; }, { signal: ctx.signal });
      ctx.root.append(button);
      ctx.onDispose(() => states.push('disposed'));
    },
    update(props: { n?: number }, ctx: IslandContext) {
      const button = ctx.root.querySelector('button')!;
      button.textContent = button.textContent!.replace(/n:.*/, `n:${props?.n ?? ''}`);
    },
    unmount() {
      unmounts++;
    },
  }));
  document.addEventListener('blazor-islands:lifecycle', onLifecycle);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  document.body.replaceChildren();
  await pastWindow();
  document.removeEventListener('blazor-islands:lifecycle', onLifecycle);
  vi.restoreAllMocks();
});

function rerender(container: HTMLElement, html: string) {
  // Same as emptyLogicalElement + insertFrame: old nodes removed, brand-new nodes created.
  container.replaceChildren();
  container.insertAdjacentHTML('beforeend', html);
}

describe('handoff when an interactive renderer re-renders prerendered DOM', () => {
  it('the replacement element adopts the instance: one mount, state and DOM kept', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const markup = `<blazor-island id="i" src="a.js" props='{"n":1}'></blazor-island>`;
    rerender(container, markup);
    await settle();
    const first = document.getElementById('i') as HTMLElement & { islandId?: number };
    const id = first.islandId;
    const button = first.shadowRoot!.querySelector('button')!;
    button.click();
    button.click();

    rerender(container, markup); // circuit/WebAssembly starts
    await settle();
    await pastWindow();

    const second = document.getElementById('i') as HTMLElement & { islandId?: number };
    expect(second).not.toBe(first);
    expect(second.islandId).toBe(id);
    expect(mounts).toBe(1);
    expect(unmounts).toBe(0);
    // The very same button (with its listener and click count) moved over.
    expect(second.shadowRoot!.querySelector('button')).toBe(button);
    expect(button.textContent).toBe('clicks:2 n:1');
    expect(events.map((e) => e.type)).toEqual(['mount', 'handoff']);
    expect(inspect()).toMatchObject({ ok: true, mounted: 1 });
  });

  it('props that changed between prerender and the interactive render are applied via update', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    rerender(container, `<blazor-island id="i" src="a.js" island-key="k" props='{"n":1}'></blazor-island>`);
    await settle();
    rerender(container, `<blazor-island id="i" src="a.js" island-key="k" props='{"n":2}'></blazor-island>`);
    await settle();
    const el = document.getElementById('i')!;
    expect(el.shadowRoot!.querySelector('button')!.textContent).toBe('clicks:0 n:2');
    expect(mounts).toBe(1);
    expect(events.map((e) => e.type)).toEqual(['mount', 'handoff', 'update']);
  });

  it('without an explicit key, a props change means a different island: old unmounts, new mounts', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    rerender(container, `<blazor-island src="a.js" props='{"n":1}'></blazor-island>`);
    await settle();
    rerender(container, `<blazor-island src="a.js" props='{"n":2}'></blazor-island>`);
    await settle();
    await pastWindow();
    expect(mounts).toBe(2);
    expect(unmounts).toBe(1);
    expect(inspect().ok).toBe(true);
  });

  it('two identical islands are each adopted exactly once', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const markup = `<blazor-island src="a.js"></blazor-island><blazor-island src="a.js"></blazor-island>`;
    rerender(container, markup);
    await settle();
    const ids = [...container.querySelectorAll('blazor-island')].map((e) => (e as any).islandId);
    rerender(container, markup);
    await settle();
    await pastWindow();
    const after = [...container.querySelectorAll('blazor-island')].map((e) => (e as any).islandId);
    expect(after.sort()).toEqual(ids.sort());
    expect(mounts).toBe(2);
    expect(unmounts).toBe(0);
    expect(inspect()).toMatchObject({ ok: true, mounted: 2 });
  });

  it('an island removed for good unmounts after the window and inspect stays clean', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    rerender(container, `<blazor-island src="a.js"></blazor-island>`);
    await settle();
    container.replaceChildren();
    await Promise.resolve();
    await Promise.resolve();
    expect(inspect().orphaned).toBe(1);
    expect(unmounts).toBe(0);
    await pastWindow();
    expect(unmounts).toBe(1);
    expect(states).toEqual(['disposed']);
    expect(inspect()).toMatchObject({ ok: true, mounted: 0, orphaned: 0 });
  });

  it('a handoff while the module is still loading mounts once, into the new element', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    setModuleLoader(async () => {
      await gate;
      return { mount(ctx: IslandContext) { mounts++; ctx.root.textContent = 'hi'; } };
    });
    const container = document.createElement('div');
    document.body.append(container);
    rerender(container, `<blazor-island id="i" src="slow.js"></blazor-island>`);
    await settle();
    rerender(container, `<blazor-island id="i" src="slow.js"></blazor-island>`);
    await settle();
    release();
    await settle();
    await pastWindow();
    const el = document.getElementById('i')!;
    expect(mounts).toBe(1);
    expect(el.shadowRoot!.textContent).toBe('hi');
    expect((el as any).islandState).toBe('mounted');
    expect(inspect().ok).toBe(true);
  });
});

describe('leaving a page', () => {
  it('a page update fired in the same task as the merge does not reach the island that was just removed', async () => {
    let updates = 0;
    let keydowns = 0;
    setModuleLoader(async () => ({
      mount(ctx: IslandContext) {
        ctx.onPageUpdate(() => updates++);
        document.addEventListener('keydown', () => keydowns++, { signal: ctx.signal });
      },
    }));
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = '<blazor-island shadow="none" hidden island-key="a.js@/page-a" src="a.js"></blazor-island>';
    await settle();
    expect(inspect().mounted).toBe(1);

    // Enhanced navigation: merge in the next page, then Blazor dispatches 'enhancedload' in the same task.
    container.innerHTML = '<p>page b</p>';
    document.dispatchEvent(new CustomEvent('blazor-islands:page-update'));
    expect(updates).toBe(0);

    // By the next task the old page's listeners are gone, before the user can type on the new page.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x' }));
    expect(keydowns).toBe(0);
    expect(inspect()).toMatchObject({ ok: true, mounted: 0 });
  });
});

describe('inspect()', () => {
  it('light-DOM (page script) islands hand off their children, never nest the old element', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const markup = `<blazor-island shadow="none" hidden island-key="page@/x" src="p.js"></blazor-island>`;
    rerender(container, markup);
    await settle();
    const button = container.querySelector('blazor-island button');
    expect(button).not.toBeNull();
    rerender(container, markup);
    await settle();
    await pastWindow();
    const islands = document.querySelectorAll('blazor-island');
    expect(islands).toHaveLength(1);
    expect(islands[0]!.querySelector('button')).toBe(button);
    expect(islands[0]!.querySelector('blazor-island')).toBeNull();
    expect(mounts).toBe(1);
    expect(inspect()).toMatchObject({ ok: true, mounted: 1 });
  });

  it('reports element and instance counts and the full history', async () => {
    document.body.insertAdjacentHTML('beforeend', `<blazor-island src="a.js"></blazor-island><blazor-island src="b.js"></blazor-island>`);
    await settle();
    const report = inspect();
    expect(report).toMatchObject({ ok: true, elements: 2, mounted: 2, loading: 0, errors: 0 });
    expect(report.instances.map((i) => i.src).sort()).toEqual(['a.js', 'b.js']);
    expect((globalThis as any).BlazorIslands.history().filter((e: IslandLifecycleDetail) => e.type === 'mount').length).toBeGreaterThanOrEqual(2);
  });
});
