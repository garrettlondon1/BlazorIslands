import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState as usePreactState } from 'preact/hooks';
import { createElement, useState } from 'react';
import { act } from 'react';
import { defineIslandElement, setModuleLoader, type IslandDefinition } from '../src/index';
import { preactIsland, useIsland as usePreactIsland } from '../src/preact';
import { createReactIslandApp, reactIsland, useIsland as useReactIsland } from '../src/react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  await act(async () => {
    document.body.replaceChildren();
    await settle();
  });
  vi.restoreAllMocks();
});

async function mountIsland(src: string, attrs: Record<string, string> = {}) {
  const el = document.createElement('blazor-island');
  el.setAttribute('src', src);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  await act(async () => {
    document.body.append(el);
    await settle();
  });
  return el as HTMLElement & { islandId?: number };
}

describe('preactIsland', () => {
  function Counter({ start }: { start: number }) {
    const [n, setN] = usePreactState(start);
    const island = usePreactIsland<{ start: number }>();
    return <button onClick={() => { setN(n + 1); island.emit('inc', n + 1); }}>{n}/{start}</button>;
  }

  it('renders, keeps state across prop updates, and unmounts', async () => {
    modules['c.js'] = preactIsland(Counter);
    const el = await mountIsland('c.js', { props: '{"start":1}' });
    const button = () => el.shadowRoot!.querySelector('button')!;
    expect(button().textContent).toBe('1/1');

    button().click();
    await settle();
    expect(button().textContent).toBe('2/1');

    el.setAttribute('props', '{"start":5}');
    await settle();
    // Same component instance: local state kept, new prop applied.
    expect(button().textContent).toBe('2/5');

    el.remove();
    await settle();
    expect(el.shadowRoot!.querySelector('button')).toBeNull();
  });

  it('useIsland exposes emit', async () => {
    modules['c.js'] = preactIsland(Counter);
    const el = await mountIsland('c.js', { props: '{"start":0}' });
    const events: unknown[] = [];
    el.addEventListener('blazor-island-event', (e) => events.push((e as CustomEvent).detail));
    el.shadowRoot!.querySelector('button')!.click();
    expect(events).toEqual([{ name: 'inc', detail: 1 }]);
  });
});

describe('reactIsland', () => {
  function Greeting({ name }: { name: string }) {
    const [clicks, setClicks] = useState(0);
    const island = useReactIsland();
    return createElement('button', { onClick: () => { setClicks(clicks + 1); island.emit('click', clicks + 1); } }, `${name}:${clicks}`);
  }

  it('renders synchronously on mount, updates in place and unmounts its root', async () => {
    modules['g.js'] = { islands: { Greeting: reactIsland(Greeting) } };
    const el = await mountIsland('g.js', { component: 'Greeting', props: '{"name":"Ada"}' });
    const button = () => el.shadowRoot!.querySelector('button');
    expect(button()!.textContent).toBe('Ada:0');

    await act(async () => { button()!.click(); });
    expect(button()!.textContent).toBe('Ada:1');

    await act(async () => { el.setAttribute('props', '{"name":"Grace"}'); await settle(); });
    expect(button()!.textContent).toBe('Grace:1');

    await act(async () => { el.remove(); await settle(); });
    expect(button()).toBeNull();
  });

  it('keeps separate roots for two islands of the same component', async () => {
    modules['g.js'] = { islands: { Greeting: reactIsland(Greeting) } };
    const a = await mountIsland('g.js', { component: 'Greeting', props: '{"name":"A"}' });
    const b = await mountIsland('g.js', { component: 'Greeting', props: '{"name":"B"}' });
    await act(async () => { a.shadowRoot!.querySelector('button')!.click(); });
    expect(a.shadowRoot!.textContent).toBe('A:1');
    expect(b.shadowRoot!.textContent).toBe('B:0');
    await act(async () => { a.remove(); await settle(); });
    expect(b.shadowRoot!.textContent).toBe('B:0');
  });
});

describe('createReactIslandApp', () => {
  it('portals every island from one root, shares wrapper state, and keeps it when islands come and go', async () => {
    const { createContext, useContext } = await import('react');
    const Count = createContext<{ n: number; inc(): void } | null>(null);
    function Provider({ children }: { children: React.ReactNode }) {
      const [n, setN] = useState(0);
      return createElement(Count.Provider, { value: { n, inc: () => setN((x) => x + 1) } }, children);
    }
    const Inc = () => {
      const c = useContext(Count)!;
      return createElement('button', { onClick: c.inc }, 'inc');
    };
    const Show = ({ label }: { label: string }) => createElement('span', null, `${label}=${useContext(Count)!.n}`);

    const app = createReactIslandApp({ components: { Inc, Show }, wrapper: Provider });
    modules['app.js'] = { islands: app.islands };

    const inc = await mountIsland('app.js', { component: 'Inc' });
    const show = await mountIsland('app.js', { component: 'Show', props: '{"label":"a"}' });
    expect(app.size).toBe(2);

    await act(async () => { inc.shadowRoot!.querySelector('button')!.click(); });
    await act(async () => { inc.shadowRoot!.querySelector('button')!.click(); });
    expect(show.shadowRoot!.textContent).toBe('a=2');

    await act(async () => { show.setAttribute('props', '{"label":"b"}'); await settle(); });
    expect(show.shadowRoot!.textContent).toBe('b=2');

    // Remove the display island, add a new one: the shared state survived.
    await act(async () => { show.remove(); await settle(); });
    expect(app.size).toBe(1);
    const again = await mountIsland('app.js', { component: 'Show', props: '{"label":"c"}' });
    expect(again.shadowRoot!.textContent).toBe('c=2');

    app.dispose();
  });
});

describe('typing', () => {
  it('preactIsland and reactIsland produce island definitions', () => {
    const p: IslandDefinition<{ start: number }> = preactIsland(({ start }: { start: number }) => <span>{start}</span>);
    expect(typeof p.mount).toBe('function');
  });
});
