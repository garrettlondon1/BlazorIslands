import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    // Solid and Svelte publish separate server builds (no reactivity, no DOM). Transform them through Vite so the browser
    // condition below applies, rather than letting Node load them with its own conditions.
    server: { deps: { inline: [/solid-js/, /svelte/] } },
  },
  resolve: { conditions: ['browser', 'development'] },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
});

