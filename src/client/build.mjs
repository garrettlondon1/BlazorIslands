// Licensed under the MIT license.
// Builds the browser assets shipped inside the BlazorIslands NuGet package (src/BlazorIslands/wwwroot).

import { build } from 'esbuild';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../BlazorIslands/wwwroot');
const require = createRequire(import.meta.url);
const watch = process.argv.includes('--watch');

await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'vendor'), { recursive: true });

const common = {
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  minify: !watch,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'info',
};

await Promise.all([
  // The runtime: <blazor-island>, lifecycle, module cache, islandFetch. Mapped as "@blazor-islands/client".
  build({ ...common, entryPoints: { 'blazor-islands': join(here, 'src/index.ts') }, outdir: out }),
  // Blazor JS initializer. The file name is the convention Blazor uses to discover it: {AssemblyName}.lib.module.js.
  build({ ...common, entryPoints: { 'BlazorIslands.lib.module': join(here, 'src/initializer.ts') }, outdir: out }),
  // Preact adapter for no-build-step islands (htm). Mapped as "@blazor-islands/client/preact"; Preact itself stays external
  // so every island shares the single vendored copy from the import map.
  build({
    ...common,
    entryPoints: { 'preact-adapter': join(here, 'src/preact.ts') },
    outdir: out,
    external: ['preact', 'preact/*'],
  }),
]);

// Vendored ESM builds of Preact, its hooks and JSX runtime, signals and htm. None of them use eval or new Function,
// so they run under a strict CSP. Each one imports the others by bare specifier, resolved by the import map.
const vendor = [
  ['preact/dist/preact.mjs', 'preact.mjs'],
  ['preact/hooks/dist/hooks.mjs', 'preact-hooks.mjs'],
  ['preact/jsx-runtime/dist/jsxRuntime.mjs', 'preact-jsx-runtime.mjs'],
  ['@preact/signals-core/dist/signals-core.mjs', 'signals-core.mjs'],
  ['@preact/signals/dist/signals.mjs', 'signals.mjs'],
  ['htm/dist/htm.mjs', 'htm.mjs'],
  ['htm/preact/index.mjs', 'htm-preact.mjs'],
];
const nodeModules = resolve(here, '../../node_modules');
for (const [from, to] of vendor) {
  await copyFile(join(nodeModules, from), join(out, 'vendor', to));
}
