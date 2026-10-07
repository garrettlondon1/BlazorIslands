// Licensed under the MIT license.
//
// Vue adapter. Bundle Vue into the app's island bundle (or a shared chunk): compile single-file components ahead of time
// (unplugin-vue, @vitejs/plugin-vue) and import the runtime-only build, which is what bundlers resolve `vue` to. The full
// build compiles templates at runtime with `new Function` and needs 'unsafe-eval', which the strict CSP forbids.

import { createApp, h, inject, shallowReactive, type App, type Component, type InjectionKey } from 'vue';
import type { IslandContext, IslandDefinition } from './types.js';

const IslandKey: InjectionKey<IslandContext<unknown>> = Symbol('blazor-island');

export interface VueIslandOptions {
  /** Constructable stylesheets or CSS text adopted into the island's shadow root. */
  styles?: Array<CSSStyleSheet | string>;
  /** Configures each app before it mounts: plugins, global components, `app.config`. */
  setup?(app: App, ctx: IslandContext<unknown>): void;
}

/** The island this component is rendered in: `emit`, `signal`, `onPageUpdate`, `element`. */
export function useIsland<P = unknown>(): IslandContext<P> {
  const ctx = inject(IslandKey, null);
  if (!ctx) {
    throw new Error('useIsland() must be called inside a component rendered by vueIsland().');
  }
  return ctx as IslandContext<P>;
}

/** Replaces the contents of a reactive props object in place, so only what changed re-renders. */
function assign(target: Record<string, unknown>, next: unknown): void {
  const source = (next ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(target)) {
    if (!(key in source)) {
      delete target[key];
    }
  }
  Object.assign(target, source);
}

/**
 * Turns a Vue component into an island: one app per island. Props from the server are held in a shallow reactive object,
 * so an update re-renders in place and the component keeps its state (refs, form input, scroll position).
 */
export function vueIsland<P>(component: Component, options: VueIslandOptions = {}): IslandDefinition<P> {
  const apps = new Map<number, { app: App; props: Record<string, unknown> }>();
  return {
    mount(ctx) {
      if (options.styles?.length) {
        ctx.adoptStyles(...options.styles);
      }
      const props = shallowReactive({ ...((ctx.props ?? {}) as Record<string, unknown>) });
      const app = createApp({ render: () => h(component, props) });
      app.provide(IslandKey, ctx as IslandContext<unknown>);
      options.setup?.(app, ctx as IslandContext<unknown>);
      app.mount(ctx.root);
      apps.set(ctx.id, { app, props });
    },
    update(props, ctx) {
      const entry = apps.get(ctx.id);
      if (entry) {
        assign(entry.props, props);
      }
    },
    unmount(ctx) {
      apps.get(ctx.id)?.app.unmount();
      apps.delete(ctx.id);
    },
  };
}

/** Turns a record of Vue components into a bundle's `islands` export. */
export function vueIslands<T extends Record<string, Component>>(
  components: T,
  options: VueIslandOptions = {},
): { [K in keyof T]: IslandDefinition<unknown> } {
  const result: Record<string, IslandDefinition<unknown>> = {};
  for (const [name, component] of Object.entries(components)) {
    result[name] = vueIsland(component, options);
  }
  return result as { [K in keyof T]: IslandDefinition<unknown> };
}
