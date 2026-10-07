import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, onUnmounted, ref } from 'vue';
import { createSignal, onCleanup } from 'solid-js';
import { compile } from 'svelte/compiler';
import { defineIslandElement, setModuleLoader } from '../src/index';
import { useIsland as useVueIsland, vueIsland } from '../src/vue';
import { solidIsland, useIsland as useSolidIsland } from '../src/solid';
import { svelteIsland } from '../src/svelte';

// The Vue, Svelte and Solid adapters must all: render props, take new props in place (component state kept, no remount),
// expose the island context, and run the framework's own teardown on unmount.

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

let modules: Record<string, unknown>;

beforeEach(() => {
  defineIslandElement();
  modules = {};
  setModuleLoader(async (url) => modules[new URL(url).pathname.slice(1)]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  document.body.replaceChildren();
  await settle();
  vi.restoreAllMocks();
});

async function mountIsland(src: string, props: unknown) {
  const el = document.createElement('blazor-island') as HTMLElement & { islandId?: number };
  el.setAttribute('src', src);
  el.setAttribute('props', JSON.stringify(props));
  document.body.append(el);
  await settle();
  return el;
}

const text = (el: Element, testid: string) => el.shadowRoot!.querySelector(`[data-testid=${testid}]`)!.textContent;
const click = (el: Element, testid: string) => (el.shadowRoot!.querySelector(`[data-testid=${testid}]`) as HTMLElement).click();

/** Drives one adapter through mount, local state, an in-place update, emit and unmount. */
async function exercise(src: string, torn: () => number) {
  const el = await mountIsland(src, { title: 'one', start: 3 });
  expect(text(el, 'title')).toBe('one');
  expect(text(el, 'count')).toBe('3');
  const id = el.islandId;

  click(el, 'inc');
  await settle();
  expect(text(el, 'count')).toBe('4');

  el.setAttribute('props', JSON.stringify({ title: 'two', start: 100 }));
  await settle();
  expect(text(el, 'title')).toBe('two');
  expect(text(el, 'count')).toBe('4');
  expect(el.islandId).toBe(id);

  const events: unknown[] = [];
  el.addEventListener('blazor-island-event', (e) => events.push((e as CustomEvent).detail));
  click(el, 'emit');
  expect(events).toEqual([{ name: 'clicked', detail: { count: 4 } }]);

  el.remove();
  await settle();
  await new Promise((r) => setTimeout(r, 20));
  expect(torn()).toBe(1);
  expect(el.shadowRoot!.querySelector('[data-testid]')).toBeNull();
}

describe('vueIsland', () => {
  it('renders, updates in place keeping state, emits and unmounts', async () => {
    let unmounted = 0;
    const Card = defineComponent({
      props: { title: String, start: Number },
      setup(props) {
        const island = useVueIsland();
        const count = ref(props.start ?? 0);
        onUnmounted(() => unmounted++);
        return () => h('div', [
          h('h3', { 'data-testid': 'title' }, props.title),
          h('output', { 'data-testid': 'count' }, String(count.value)),
          h('button', { 'data-testid': 'inc', onClick: () => count.value++ }),
          h('button', { 'data-testid': 'emit', onClick: () => island.emit('clicked', { count: count.value }) }),
        ]);
      },
    });
    modules['vue.js'] = { default: vueIsland(Card) };
    await exercise('vue.js', () => unmounted);
  });
});

describe('solidIsland', () => {
  it('renders, reconciles new props keeping signals, emits and disposes', async () => {
    let disposed = 0;
    // Solid's hyperscript: function children are reactive, like compiled JSX expressions.
    const { default: hs } = await import('solid-js/h');
    function Card(props: { title: string; start: number }) {
      const island = useSolidIsland();
      const [count, setCount] = createSignal(props.start);
      onCleanup(() => disposed++);
      return hs('div', [
        hs('h3', { 'data-testid': 'title' }, () => props.title),
        hs('output', { 'data-testid': 'count' }, () => String(count())),
        hs('button', { 'data-testid': 'inc', onClick: () => setCount(count() + 1) }),
        hs('button', { 'data-testid': 'emit', onClick: () => island.emit('clicked', { count: count() }) }),
      ]) as unknown as Element;
    }
    modules['solid.js'] = { default: solidIsland(Card as any) };
    await exercise('solid.js', () => disposed);
  });
});

describe('svelteIsland', () => {
  it('renders, updates props through the store-backed proxy keeping $state, emits and unmounts', async () => {
    const source = `
      <script>
        import { onDestroy } from 'svelte';
        import { getIsland } from 'island';
        let { title, start } = $props();
        const island = getIsland();
        let count = $state(start);
        onDestroy(() => globalThis.__svelteTorn++);
      </script>
      <h3 data-testid="title">{title}</h3>
      <output data-testid="count">{count}</output>
      <button data-testid="inc" onclick={() => count++}>+</button>
      <button data-testid="emit" onclick={() => island.emit('clicked', { count })}>!</button>`;
    const { js } = compile(source, { generate: 'client', filename: 'Card.svelte' });
    // Link the compiled module to this test's copies of svelte and the adapter.
    // @ts-ignore -- svelte publishes no declarations for its compiler runtime.
    const svelteInternal = await import('svelte/internal/client');
    const svelte = await import('svelte');
    const adapter = await import('../src/svelte');
    const code = js.code
      .replace(/^import .*$/gm, '')
      .replace(/export default function (\w+)/, 'const __default = function $1') + '\nreturn __default;';
    (globalThis as { __svelteTorn?: number }).__svelteTorn = 0;
    // eslint-disable-next-line no-new-func
    const factory = new Function('$', 'onDestroy', 'getIsland', `"use strict"; ${code}`);
    const Card = factory(svelteInternal, svelte.onDestroy, adapter.getIsland);
    modules['svelte.js'] = { default: svelteIsland(Card) };
    await exercise('svelte.js', () => (globalThis as { __svelteTorn?: number }).__svelteTorn!);
  });
});
