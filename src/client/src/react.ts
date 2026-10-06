// Licensed under the MIT license.
//
// React adapter. React is bundled into the app's own bundle (React has no browser ESM build to put in an import map),
// so import this from a bundle entry, not from the import map.
//
// Two shapes:
// - reactIsland / reactIslands: one React root per island. Simple; islands are independent.
// - createReactIslandApp: ONE React root for the whole page that renders each island's component into its element
//   through a portal. Islands share context (stores, routers, query clients, theme) and the root outlives enhanced
//   navigation, so app-level state survives page changes while individual islands come and go.

import { createContext, createElement, Fragment, useContext, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { IslandContext, IslandDefinition } from './types.js';

const IslandContextKey = createContext<IslandContext<unknown> | null>(null);

/** The island this component is rendered in: `emit`, `signal`, `onPageUpdate`, `element`. */
export function useIsland<P = unknown>(): IslandContext<P> {
  const ctx = useContext(IslandContextKey);
  if (!ctx) {
    throw new Error('useIsland() must be called inside a component rendered by a React island.');
  }
  return ctx as IslandContext<P>;
}

type Wrapper = ComponentType<{ children: ReactNode }>;

export interface ReactIslandOptions {
  /** Wraps the component, e.g. a context provider. */
  wrapper?: Wrapper;
  /** Constructable stylesheets or CSS text adopted into the island's shadow root. */
  styles?: Array<CSSStyleSheet | string>;
}

function element<P>(Component: ComponentType<P>, ctx: IslandContext<P>, props: P, wrapper?: Wrapper) {
  const inner = createElement(
    IslandContextKey.Provider,
    { value: ctx as IslandContext<unknown> },
    createElement(Component as ComponentType<any>, (props ?? {}) as any),
  );
  return wrapper ? createElement(wrapper, null, inner) : inner;
}

/** Turns a React component into an island with its own root. Props updates re-render in place, keeping state. */
export function reactIsland<P>(Component: ComponentType<P>, options: ReactIslandOptions = {}): IslandDefinition<P> {
  const roots = new Map<number, Root>();
  return {
    mount(ctx) {
      if (options.styles?.length) {
        ctx.adoptStyles(...options.styles);
      }
      const root = createRoot(ctx.root as unknown as Element);
      roots.set(ctx.id, root);
      // Synchronous so the island is on screen when mount resolves, and so unmount never races a pending render.
      flushSync(() => root.render(element(Component, ctx, ctx.props, options.wrapper)));
    },
    update(props, ctx) {
      const root = roots.get(ctx.id);
      if (root) {
        flushSync(() => root.render(element(Component, ctx, props, options.wrapper)));
      }
    },
    unmount(ctx) {
      const root = roots.get(ctx.id);
      roots.delete(ctx.id);
      root?.unmount();
    },
  };
}

/** Turns a record of React components into a bundle's `islands` export, one root per island. */
export function reactIslands<T extends Record<string, ComponentType<any>>>(
  components: T,
  options: ReactIslandOptions = {},
): { [K in keyof T]: IslandDefinition<T[K] extends ComponentType<infer P> ? P : never> } {
  const result: Record<string, IslandDefinition<any>> = {};
  for (const [name, component] of Object.entries(components)) {
    result[name] = reactIsland(component, options);
  }
  return result as any;
}

interface Slot {
  id: number;
  Component: ComponentType<any>;
  ctx: IslandContext<unknown>;
  props: unknown;
}

export interface ReactIslandApp<T extends Record<string, ComponentType<any>>> {
  /** Export this from the bundle: `export const islands = app.islands;` */
  readonly islands: { [K in keyof T]: IslandDefinition<T[K] extends ComponentType<infer P> ? P : never> };
  /** Number of islands currently rendered by the app. */
  readonly size: number;
  /** Unmounts the shared root. Islands mounted afterwards create a new one. */
  dispose(): void;
}

export interface ReactIslandAppOptions<T> {
  components: T;
  /** Wraps every island in the shared tree: providers, stores, error boundaries. Mounted once for the page's lifetime. */
  wrapper?: Wrapper;
  styles?: Array<CSSStyleSheet | string>;
}

/**
 * One React root for every island on the page. The root renders into a detached container and portals each island's
 * component into that island's element. Because the root is never attached to the document, Blazor's DOM merge cannot
 * remove it, and state held above the portals (in `wrapper`) survives enhanced navigation.
 */
export function createReactIslandApp<T extends Record<string, ComponentType<any>>>(options: ReactIslandAppOptions<T>): ReactIslandApp<T> {
  const slots = new Map<number, Slot>();
  const listeners = new Set<() => void>();
  let snapshot: Slot[] = [];
  let root: Root | undefined;

  const publish = () => {
    snapshot = [...slots.values()];
    for (const listener of listeners) {
      listener();
    }
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const getSnapshot = () => snapshot;

  function Portals() {
    const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return createElement(
      Fragment,
      null,
      current.map((slot) =>
        createPortal(
          createElement(
            IslandContextKey.Provider,
            { value: slot.ctx },
            createElement(slot.Component, (slot.props ?? {}) as any),
          ),
          slot.ctx.root as unknown as Element,
          String(slot.id),
        ),
      ),
    );
  }

  function ensureRoot() {
    if (!root) {
      root = createRoot(document.createElement('div'));
      const tree = options.wrapper ? createElement(options.wrapper, null, createElement(Portals)) : createElement(Portals);
      flushSync(() => root!.render(tree));
    }
  }

  const islands: Record<string, IslandDefinition<any>> = {};
  for (const [name, Component] of Object.entries(options.components)) {
    islands[name] = {
      mount(ctx) {
        if (options.styles?.length) {
          ctx.adoptStyles(...options.styles);
        }
        ensureRoot();
        flushSync(() => {
          slots.set(ctx.id, { id: ctx.id, Component, ctx, props: ctx.props });
          publish();
        });
      },
      update(props, ctx) {
        const slot = slots.get(ctx.id);
        if (slot) {
          flushSync(() => {
            slots.set(ctx.id, { ...slot, props });
            publish();
          });
        }
      },
      unmount(ctx) {
        if (slots.delete(ctx.id)) {
          flushSync(publish);
        }
      },
    };
  }

  return {
    islands: islands as any,
    get size() {
      return slots.size;
    },
    dispose() {
      slots.clear();
      snapshot = [];
      root?.unmount();
      root = undefined;
    },
  };
}
