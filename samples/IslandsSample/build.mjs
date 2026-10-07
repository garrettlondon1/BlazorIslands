// Bundles island sources into wwwroot/islands. Runs before `dotnet build` so the static asset manifest includes them.
import { transformAsync } from '@babel/core';
import { build } from 'esbuild';
import svelte from 'esbuild-svelte';
import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from 'unplugin-vue/esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, 'islands-src');
const out = join(here, 'wwwroot', 'islands');
const fable = join(src, 'fable');
const production = process.env.NODE_ENV !== 'development';

// Generated bundles (and their chunks) are the only build output; hand-written islands live next to them.
await rm(join(out, 'chunks'), { recursive: true, force: true });

// F# islands: Fable compiles them to JavaScript (Feliz) and Solid JSX (Oxpecker.Solid) under islands-src/fable, and
// esbuild bundles that output like any other source.
function dotnet(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('dotnet', args, { cwd: here, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    child.on('close', (code) => (code === 0 && !/\berror\b/i.test(log) ? resolve() : reject(new Error(`dotnet ${args.join(' ')}\n${log}`))));
  });
}
await Promise.all([
  dotnet(['fable', '../IslandsSample.Fable/Feliz/IslandsSample.Fable.Feliz.fsproj', '-o', join(fable, 'feliz'), '--silent']),
  dotnet(['fable', '../IslandsSample.Fable/Solid/IslandsSample.Fable.Solid.fsproj', '-o', join(fable, 'solid'), '--extension', '.jsx', '--silent']),
]);

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

// Solid's JSX compiles to fine-grained DOM updates, which only babel-preset-solid does. Its built-ins (For, Show, ...)
// are imported automatically, which Oxpecker.Solid's output relies on.
const solidJsx = {
  name: 'solid-jsx',
  setup(b) {
    b.onLoad({ filter: /\.(jsx|tsx)$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8');
      const result = await transformAsync(source, {
        filename: args.path,
        presets: [['babel-preset-solid', { generate: 'dom' }], ['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
        sourceMaps: 'inline',
        babelrc: false,
        configFile: false,
      });
      return { contents: result.code, loader: 'js' };
    });
  },
};

await Promise.all([
  build({
    ...common,
    entryPoints: { 'preact-bundle': join(src, 'preact-bundle.tsx'), 'slow-bundle': join(src, 'slow-bundle.tsx') },
    jsx: 'automatic',
    jsxImportSource: 'preact',
    plugins: [exactExternals(importMapped)],
  }),
  // React bundles, in TSX and in F# (Feliz), share one React through code splitting.
  build({
    ...common,
    entryPoints: {
      'react-bundle': join(src, 'react-bundle.tsx'),
      'react-app': join(src, 'react-app.tsx'),
      'feliz-bundle': join(fable, 'feliz', 'Islands.js'),
    },
    jsx: 'automatic',
    jsxImportSource: 'react',
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    plugins: [exactExternals(['@blazor-islands/client'])],
  }),
  // Vue single-file components, compiled ahead of time: the bundle carries the runtime-only build (no 'unsafe-eval').
  // Scoped styles land in vue-bundle.css, which <Island Styles> links into each island's shadow root.
  build({
    ...common,
    entryPoints: { 'vue-bundle': join(src, 'vue-bundle.ts') },
    define: {
      ...common.define,
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
    // The plugin's own source maps end up inside the extracted CSS, where they are a syntax error; esbuild still maps JS.
    plugins: [exactExternals(['@blazor-islands/client']), vue({ sourceMap: false })],
  }),
  // Svelte 5. css: 'external' writes component styles to svelte-bundle.css instead of injecting <style> elements,
  // which style-src 'self' blocks.
  build({
    ...common,
    entryPoints: { 'svelte-bundle': join(src, 'svelte-bundle.ts') },
    mainFields: ['svelte', 'browser', 'module', 'main'],
    conditions: ['svelte', 'browser'],
    plugins: [exactExternals(['@blazor-islands/client']), svelte({ compilerOptions: { css: 'external', dev: !production } })],
  }),
  // Solid, written in F# with Oxpecker.Solid.
  build({
    ...common,
    entryPoints: { 'solid-bundle': join(fable, 'solid', 'Islands.jsx') },
    plugins: [exactExternals(['@blazor-islands/client']), solidJsx],
  }),
]);
