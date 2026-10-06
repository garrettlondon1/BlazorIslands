import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
});

