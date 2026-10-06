// Bundles island sources into wwwroot/islands. Runs before `dotnet build` so the static asset manifest includes them.
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'islands-src');
const out = join(here, 'wwwroot', 'islands');
const production = process.env.NODE_ENV !== 'development';

// Generated bundles (and their chunks) are the only build output; hand-written islands live next to them.
await rm(join(out, 'chunks'), { recursive: true, force: true });

const common = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  outdir: out,
  minify: production,
  sourcemap: true,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
};

// Everything the import map provides stays external, so all Preact islands share one Preact. Matched exactly: esbuild's
// `external: ['pkg']` also externalizes every subpath, which would leave '@blazor-islands/client/react' unbundled.
const importMapped = ['preact', 'preact/hooks', 'preact/jsx-runtime', '@preact/signals', '@preact/signals-core', 'htm', 'htm/preact', '@blazor-islands/client', '@blazor-islands/client/preact'];

const exactExternals = (specifiers) => ({
  name: 'exact-externals',
  setup(b) {
    const set = new Set(specifiers);
    b.onResolve({ filter: /.*/ }, (args) => (set.has(args.path) ? { path: args.path, external: true } : undefined));
  },
});

await Promise.all([
  build({
    ...common,
    entryPoints: { 'preact-bundle': join(src, 'preact-bundle.tsx'), 'slow-bundle': join(src, 'slow-bundle.tsx') },
    jsx: 'automatic',
    jsxImportSource: 'preact',
    plugins: [exactExternals(importMapped)],
  }),
  // React bundles share one React through code splitting.
  build({
    ...common,
    entryPoints: { 'react-bundle': join(src, 'react-bundle.tsx'), 'react-app': join(src, 'react-app.tsx') },
    jsx: 'automatic',
    jsxImportSource: 'react',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    plugins: [exactExternals(['@blazor-islands/client'])],
  }),
]);

