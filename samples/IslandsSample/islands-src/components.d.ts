// Single-file components are compiled by the bundler's Vue and Svelte plugins; TypeScript only needs their shape.
declare module '*.vue' {
  import type { Component } from 'vue';
  const component: Component;
  export default component;
}

declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component<any>;
  export default component;
}
