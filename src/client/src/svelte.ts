// Licensed under the MIT license.
//
// Svelte 5 adapter. Bundle Svelte and the compiled components into the app's island bundle (esbuild-svelte,
// @sveltejs/vite-plugin-svelte). Compile with `css: 'external'` and pass the bundle's CSS to <Island Styles>: Svelte's
// default injects a <style> element, which a strict CSP (style-src 'self') blocks.

import { getContext, mount, unmount, type Component } from 'svelte';
import { fromStore, writable } from 'svelte/store';
import type { IslandContext, IslandDefinition } from './types.js';

const IslandKey = Symbol.for('blazor-islands.svelte');

export interface SvelteIslandOptions {
  /** Constructable stylesheets or CSS text adopted into the island's shadow root. */
  styles?: Array<CSSStyleSheet | string>;
}

/** The island this component is rendered in: `emit`, `signal`, `onPageUpdate`, `element`. Call during component init. */
export function getIsland<P = unknown>(): IslandContext<P> {
  const ctx = getContext<IslandContext<P> | undefined>(IslandKey);
  if (!ctx) {
    throw new Error('getIsland() must be called while initializing a component rendered by svelteIsland().');
  }
  return ctx;
}

/**
 * Props object whose every read goes through a store: Svelte components read `$props()` lazily, so reads inside the
 * template subscribe, and `set` re-renders exactly what changed without remounting.
 */
function reactiveProps(initial: unknown) {
  const store = writable((initial ?? {}) as Record<string | symbol, unknown>);
  const current = fromStore(store);
  const props = new Proxy({} as Record<string | symbol, unknown>, {
    get: (_, key) => current.current[key],
    has: (_, key) => key in current.current,
    ownKeys: () => Reflect.ownKeys(current.current),
    getOwnPropertyDescriptor: (_, key) =>
      key in current.current ? { enumerable: true, configurable: true, value: current.current[key] } : undefined,
  });
  return { props, set: (next: unknown) => store.set((next ?? {}) as Record<string | symbol, unknown>) };
}

/**
 * Turns a Svelte 5 component into an island. Props updates from the server re-render in place: component state ($state,
 * bindings, focus) survives enhanced navigation, streaming and interactive re-renders.
 */
export function svelteIsland<P extends Record<string, any>>(component: Component<P>, options: SvelteIslandOptions = {}): IslandDefinition<P> {
  const mounted = new Map<number, { instance: Record<string, unknown>; set(next: unknown): void }>();
  return {
    mount(ctx) {
      if (options.styles?.length) {
        ctx.adoptStyles(...options.styles);
      }
      const { props, set } = reactiveProps(ctx.props);
      const instance = mount(component, {
        target: ctx.root,
        props: props as P,
        context: new Map([[IslandKey, ctx]]),
      });
      mounted.set(ctx.id, { instance, set });
    },
    update(props, ctx) {
      mounted.get(ctx.id)?.set(props);
    },
    unmount(ctx) {
      const entry = mounted.get(ctx.id);
      mounted.delete(ctx.id);
      if (entry) {
        void unmount(entry.instance);
      }
    },
  };
}

/** Turns a record of Svelte components into a bundle's `islands` export. */
export function svelteIslands<T extends Record<string, Component<any>>>(
  components: T,
  options: SvelteIslandOptions = {},
): { [K in keyof T]: IslandDefinition<T[K] extends Component<infer P> ? P : never> } {
  const result: Record<string, IslandDefinition<any>> = {};
  for (const [name, component] of Object.entries(components)) {
    result[name] = svelteIsland(component, options);
  }
  return result as any;
}
