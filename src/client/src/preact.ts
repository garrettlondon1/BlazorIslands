// Licensed under the MIT license.
//
// Preact adapter. Works for htm (no build step) and TSX alike. Import 'preact' through the import map that
// <IslandsHead /> renders, so every Preact island and bundle on the page shares one copy of Preact, its hooks and signals.

import { createContext, h, render, type ComponentType } from 'preact';
import { useContext } from 'preact/hooks';
import type { IslandContext, IslandDefinition } from './types.js';

const IslandContextKey = createContext<IslandContext<unknown> | null>(null);

export interface PreactIslandOptions {
  /** Constructable stylesheets or CSS text adopted into the island's shadow root. */
  styles?: Array<CSSStyleSheet | string>;
}

function vnode<P>(Component: ComponentType<P>, ctx: IslandContext<P>, props: P) {
  return h(IslandContextKey.Provider, { value: ctx as IslandContext<unknown> }, h(Component as ComponentType<any>, (props ?? {}) as any));
}

/** Turns a Preact component into an island. Props updates re-render in place, keeping component state. */
export function preactIsland<P>(Component: ComponentType<P>, options: PreactIslandOptions = {}): IslandDefinition<P> {
  return {
    mount(ctx) {
      if (options.styles?.length) {
        ctx.adoptStyles(...options.styles);
      }
      render(vnode(Component, ctx, ctx.props), ctx.root);
    },
    update(props, ctx) {
      render(vnode(Component, ctx, props), ctx.root);
    },
    unmount(ctx) {
      render(null, ctx.root);
    },
  };
}

/** Turns a record of Preact components into a bundle's `islands` export. */
export function preactIslands<T extends Record<string, ComponentType<any>>>(
  components: T,
  options: PreactIslandOptions = {},
): { [K in keyof T]: IslandDefinition<T[K] extends ComponentType<infer P> ? P : never> } {
  const result: Record<string, IslandDefinition<any>> = {};
  for (const [name, component] of Object.entries(components)) {
    result[name] = preactIsland(component, options);
  }
  return result as any;
}

/** The island this component is rendered in: `emit`, `signal`, `onPageUpdate`, `element`. */
export function useIsland<P = unknown>(): IslandContext<P> {
  const ctx = useContext(IslandContextKey);
  if (!ctx) {
    throw new Error('useIsland() must be called inside a component rendered by preactIsland().');
  }
  return ctx as IslandContext<P>;
}
