// Licensed under the MIT license.
//
// Solid adapter. Bundle Solid into the app's island bundle and compile JSX with babel-preset-solid (vite-plugin-solid,
// or a Babel step in esbuild). Works for TSX components and for F# components compiled by Fable with Oxpecker.Solid.

import { createComponent, createContext, useContext, type Component } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { render } from 'solid-js/web';
import type { IslandContext, IslandDefinition } from './types.js';

const IslandContextKey = createContext<IslandContext<unknown>>();

export interface SolidIslandOptions {
  /** Constructable stylesheets or CSS text adopted into the island's shadow root. */
  styles?: Array<CSSStyleSheet | string>;
}

/** The island this component is rendered in: `emit`, `signal`, `onPageUpdate`, `element`. */
export function useIsland<P = unknown>(): IslandContext<P> {
  const ctx = useContext(IslandContextKey);
  if (!ctx) {
    throw new Error('useIsland() must be called inside a component rendered by solidIsland().');
  }
  return ctx as IslandContext<P>;
}

/**
 * Turns a Solid component into an island. Props live in a store and server updates are reconciled into it, so only the
 * fields that changed re-run: signals, effects and DOM owned by the component survive.
 *
 * The component receives the store as its single argument: `props.count` in TSX, or a record parameter in Oxpecker.Solid
 * (`[<SolidComponent>] let Counter (props: CounterProps) = ...`), read inside JSX so the read stays reactive.
 */
export function solidIsland<P extends object>(component: Component<P>, options: SolidIslandOptions = {}): IslandDefinition<P> {
  const mounted = new Map<number, { dispose(): void; set(next: P): void }>();
  return {
    mount(ctx) {
      if (options.styles?.length) {
        ctx.adoptStyles(...options.styles);
      }
      const [props, setProps] = createStore<P>(structuredClone((ctx.props ?? {}) as P));
      const dispose = render(
        () => createComponent(IslandContextKey.Provider, {
          value: ctx as IslandContext<unknown>,
          get children() {
            return createComponent(component, props);
          },
        }),
        ctx.root,
      );
      mounted.set(ctx.id, { dispose, set: (next) => setProps(reconcile((next ?? {}) as P)) });
    },
    update(props, ctx) {
      mounted.get(ctx.id)?.set(props);
    },
    unmount(ctx) {
      mounted.get(ctx.id)?.dispose();
      mounted.delete(ctx.id);
    },
  };
}

/** Turns a record of Solid components into a bundle's `islands` export. */
export function solidIslands<T extends Record<string, Component<any>>>(
  components: T,
  options: SolidIslandOptions = {},
): { [K in keyof T]: IslandDefinition<T[K] extends Component<infer P> ? P : never> } {
  const result: Record<string, IslandDefinition<any>> = {};
  for (const [name, component] of Object.entries(components)) {
    result[name] = solidIsland(component, options);
  }
  return result as any;
}
