import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineIslandElement, getRuntime, inspect, setModuleLoader, type IslandContext } from '../src/index';

// JS components: <blazor-island attach> wraps markup Blazor owns. The runtime must never touch those children, must
// find refs live, follow the component through handoff, and bridge calls to and from .NET.

const settle = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};
const pastWindow = () => new Promise((r) => setTimeout(r, getRuntime().handoffWindowMs + 20));
const tools = () => (globalThis as any).BlazorIslands;

let created: number;
let log: string[];

class Widget {
  clicks = 0;
  constructor(public ctx: IslandContext<{ label: string }>) {
    created++;
    log.push(`construct:${ctx.props?.label}`);
    ctx.on('click', '[data-ref="btn"]', () => {
      this.clicks++;
      ctx.ref('out')!.textContent = String(this.clicks);
    });
  }
  update(props: { label: string }) {
    log.push(`update:${props.label}`);
  }
  rendered() {
    log.push('rendered');
    const out = this.ctx.ref('out');
    if (out && out.textContent !== String(this.clicks)) {
      out.textContent = String(this.clicks);
    }
  }
  echo(a: number, b: number) {
    return `${a + b} from #${this.ctx.id}`;
  }
  unmount() {
    log.push('unmount');
  }
}

beforeEach(() => {
  defineIslandElement();
  created = 0;
  log = [];
  setModuleLoader(async (url) => (url.endsWith('plain.js')
    ? { mount() {}, add(a: number, b: number, ctx: IslandContext) { return a + b + ctx.id * 0; } }
    : { default: Widget }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  document.body.replaceChildren();
  await pastWindow();
  vi.restoreAllMocks();
});

const markup = (label: string, extra = '') =>
  `<blazor-island attach src="w.js" island-key="p|js:w" props='{"label":"${label}"}' ${extra}>`
  + `<button data-ref="btn">b</button><output data-ref="out">0</output>`
  + `<blazor-island attach src="w.js" island-key="p|js:inner" props='{"label":"inner"}'><output data-ref="out">inner</output></blazor-island>`
  + `</blazor-island>`;

describe('JS components (attach)', () => {
  it('one class instance per component; Blazor-owned children are never touched', async () => {
    document.body.innerHTML = markup('a');
    const host = document.body.firstElementChild as any;
    const button = host.querySelector('button');
    await settle();
    expect(created).toBe(2); // outer + nested
    expect(host.shadowRoot).toBeNull();
    expect(host.querySelector('button')).toBe(button);
    expect(log).toContain('construct:a');
    expect(inspect().ok).toBe(true);
  });

  it('ref() is scoped: nested components own their refs', async () => {
    document.body.innerHTML = markup('a');
    await settle();
    const host = document.body.firstElementChild!;
    host.querySelector('button')!.click();
    expect(host.querySelector(':scope > output')!.textContent).toBe('1');
    expect(host.querySelector(':scope blazor-island output')!.textContent).toBe('inner');
  });

  it('props changes call update on the same instance', async () => {
    document.body.innerHTML = markup('a');
    await settle();
    const host = document.body.firstElementChild!;
    host.setAttribute('props', '{"label":"b"}');
    await settle();
    expect(log).toContain('update:b');
    expect(created).toBe(2);
  });

  it('rendered() runs after Blazor changes the markup, not after the component changes it itself', async () => {
    document.body.innerHTML = markup('a');
    await settle();
    const host = document.body.firstElementChild!;
    host.querySelector('button')!.click(); // the component's own DOM write
    await settle();
    expect(log.filter((l) => l === 'rendered')).toHaveLength(0);

    // Blazor re-renders the output with server text: rendered() restores the JS-owned value.
    host.querySelector(':scope > output')!.textContent = '0';
    await settle();
    expect(log.filter((l) => l === 'rendered').length).toBeGreaterThanOrEqual(1);
    expect(host.querySelector(':scope > output')!.textContent).toBe('1');
  });

  it('handoff: the instance moves to the re-rendered markup and its listeners follow', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = markup('a');
    await settle();
    container.querySelector('button')!.click();
    const id = (container.firstElementChild as any).islandId;

    container.replaceChildren();
    container.insertAdjacentHTML('beforeend', markup('a', 'interactive'));
    await settle();
    await pastWindow();

    const host = container.firstElementChild as any;
    expect(host.islandId).toBe(id);
    expect(created).toBe(2);
    // rendered() repainted the JS state into the fresh markup...
    expect(host.querySelector(':scope > output')!.textContent).toBe('1');
    // ...and the delegated click listener is bound to the new element.
    host.querySelector('button')!.click();
    expect(host.querySelector(':scope > output')!.textContent).toBe('2');
    expect(inspect()).toMatchObject({ ok: true });
  });

  it('BlazorIslands.invoke calls class methods with the .NET arguments', async () => {
    document.body.innerHTML = markup('a');
    await settle();
    const host = document.body.firstElementChild!;
    await expect(tools().invoke(host, 'echo', [2, 3])).resolves.toMatch(/^5 from #\d+$/);
    await expect(tools().invoke(host, 'nope', [])).rejects.toThrow(/no method 'nope'/);
    await expect(tools().invoke(host, 'unmount', [])).rejects.toThrow(/no method 'unmount'/);
  });

  it('BlazorIslands.invoke calls object-definition functions with ctx appended', async () => {
    document.body.innerHTML = `<blazor-island attach src="plain.js" island-key="k"></blazor-island>`;
    await settle();
    await expect(tools().invoke(document.body.firstElementChild, 'add', [2, 3])).resolves.toBe(5);
  });

  it('invoke waits for a module that is still loading', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    setModuleLoader(async () => { await gate; return { default: Widget }; });
    document.body.innerHTML = markup('a');
    await settle();
    const pending = tools().invoke(document.body.firstElementChild, 'echo', [1, 1]);
    release();
    await expect(pending).resolves.toMatch(/^2 from/);
  });

  it('invokeDotNet: rejects on a static page, waits while interactive-pending, resolves once connected', async () => {
    document.body.innerHTML = markup('static');
    await settle();
    const staticCtx = (getRuntime().live.values().next().value as any).context as IslandContext;
    await expect(staticCtx.invokeDotNet('X')).rejects.toThrow(/statically rendered/);

    document.body.innerHTML = markup('pending', 'interactive-pending');
    await settle();
    const host = document.body.firstElementChild as any;
    const ctx = ([...getRuntime().live].find((i: any) => i.host.element === host) as any).context as IslandContext;
    expect(ctx.interactive).toBe(false);
    const call = ctx.invokeDotNet<string>('Hello', 'x');
    const dotnet = { invokeMethodAsync: vi.fn(async (m: string, a: string) => `${m}(${a})`) };
    tools().connect(host, dotnet);
    await expect(call).resolves.toBe('Hello(x)');
    expect(ctx.interactive).toBe(true);
    expect(dotnet.invokeMethodAsync).toHaveBeenCalledWith('Hello', 'x');
  });

  it('connect before the instance exists is applied when it starts; connect on a removed element is ignored', async () => {
    document.body.innerHTML = markup('a', 'interactive');
    const host = document.body.firstElementChild as any;
    const dotnet = { invokeMethodAsync: vi.fn(async () => 'ok') };
    tools().connect(host, dotnet);
    await settle();
    const ctx = ([...getRuntime().live].find((i: any) => i.host.element === host) as any).context as IslandContext;
    expect(ctx.interactive).toBe(true);
    expect(() => tools().connect(document.createElement('div'), dotnet)).not.toThrow();
  });

  it('removal unmounts the instance and forgets the .NET reference', async () => {
    document.body.innerHTML = markup('a', 'interactive');
    await settle();
    document.body.replaceChildren();
    await pastWindow();
    expect(log.filter((l) => l === 'unmount')).toHaveLength(2);
    expect(inspect()).toMatchObject({ ok: true, mounted: 0 });
  });
});
