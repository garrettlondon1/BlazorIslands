import { defineConfig, devices, type PlaywrightTestProject } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const sample = resolve(import.meta.dirname, '../../samples/IslandsSample');
const quickStart = resolve(import.meta.dirname, '../../samples/QuickStart');
const published = resolve(import.meta.dirname, '../../artifacts/e2e-publish');
const subPath = '/coolapp';

// Optional: a dotnet/aspnetcore clone, from ASPNETCORE_REPO or a sibling folder named aspnetcore.
const aspnetcoreRepo = process.env.ASPNETCORE_REPO ?? resolve(import.meta.dirname, '../../../aspnetcore');

// blazor.web.js built from that clone (`npm run build:production` in src/Components/Web.JS).
const aspnetcoreWebJs = process.env.ASPNETCORE_WEB_JS
  ?? resolve(aspnetcoreRepo, 'src/Components/Web.JS/dist/Release/_framework/blazor.web.js');
const withClone = existsSync(aspnetcoreWebJs) && process.env.SKIP_ASPNETCORE !== '1';

// Optional: the sample's net11.0 build (BLAZOR_ISLANDS_NEXT=1), run on the .NET 11 runtime restored by the clone.
const dotnet11 = process.env.DOTNET11 ?? resolve(aspnetcoreRepo, '.dotnet', process.platform === 'win32' ? 'dotnet.exe' : 'dotnet');
const net11Dll = resolve(sample, 'bin/Debug/net11.0/IslandsSample.dll');
const withNet11 = existsSync(dotnet11) && existsSync(net11Dll) && process.env.SKIP_NET11 !== '1';

const server = (port: number, env: Record<string, string> = {}, command?: string) => ({
  command: command ?? `dotnet run --no-build --no-launch-profile --framework net10.0 --project "${sample}" --urls http://127.0.0.1:${port}`,
  cwd: sample,
  url: `http://127.0.0.1:${port}/`,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
  env: { ASPNETCORE_ENVIRONMENT: 'Development', ...env },
  stdout: 'ignore' as const,
  stderr: 'pipe' as const,
});

const browsers = (process.env.BROWSERS ?? 'chromium,firefox,webkit').split(',');
const deviceFor = { chromium: devices['Desktop Chrome'], firefox: devices['Desktop Firefox'], webkit: devices['Desktop Safari'] } as const;

// One server per app mode; the matrix spec runs once per mode.
const appModes = {
  'enhanced': 5190,
  'no-enhanced-nav': 5194,
  'no-dom-preservation': 5195,
  'global-server': 5196,
  'global-wasm': 5197,
  'global-auto': 5198,
} as const;

const matrix = (mode: keyof typeof appModes, browser: keyof typeof deviceFor, port: number = appModes[mode], suffix = '', extra: Record<string, unknown> = {}): PlaywrightTestProject => ({
  name: `matrix-${mode}${suffix}${browser === 'chromium' ? '' : `-${browser}`}`,
  testMatch: /matrix\.spec\.ts/,
  metadata: { appMode: mode, ...extra },
  use: { ...deviceFor[browser], baseURL: `http://127.0.0.1:${port}` },
  // Firefox and WebKit download and compile the WebAssembly runtime noticeably slower under parallel load.
  ...(browser === 'chromium' ? {} : { timeout: 90_000 }),
});

const matrixOnly = process.env.MATRIX_ONLY === '1';

export default defineConfig({
  testDir: './specs',
  fullyParallel: true,
  workers: process.env.WORKERS ? Number(process.env.WORKERS) : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }], ['./matrix-reporter.ts']],
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: { trace: 'retain-on-failure' },
  webServer: [
    { ...server(5210, {}, `dotnet run --no-build --no-launch-profile --project "${quickStart}" --urls http://127.0.0.1:5210`), cwd: quickStart },
    // Strict(): script-src 'self' 'nonce-…' 'wasm-unsafe-eval'
    server(appModes.enhanced),
    // The published app in Production: fingerprinting, compression and caching as users get them.
    ...(matrixOnly ? [] : [{
      ...server(5220, { ASPNETCORE_ENVIRONMENT: 'Production' }, `dotnet publish "${sample}" -c Release -f net10.0 -o "${published}" --nologo -v q && dotnet "${resolve(published, 'IslandsSample.dll')}" --contentRoot "${published}" --urls http://127.0.0.1:5220`),
      timeout: 300_000,
    }]),
    server(appModes['no-enhanced-nav'], { Islands__AppMode: 'no-enhanced-nav' }),
    server(appModes['no-dom-preservation'], { Islands__AppMode: 'no-dom-preservation' }),
    server(appModes['global-server'], { Islands__AppMode: 'global-server' }),
    server(appModes['global-wasm'], { Islands__AppMode: 'global-wasm' }),
    server(appModes['global-auto'], { Islands__AppMode: 'global-auto' }),
    // Sub-path hosting: the app lives at /coolapp, and the server 404s everything outside it.
    { ...server(5199, { Islands__PathBase: subPath }), url: `http://127.0.0.1:5199${subPath}/` },
    // StrictDynamic(): script-src 'self' 'nonce-…' 'strict-dynamic' (the web.dev "strict CSP" shape)
    server(5192, { Islands__Csp: 'strict-dynamic' }),
    ...(withClone ? [server(5191, { BLAZOR_WEB_JS: aspnetcoreWebJs })] : []),
    ...(withNet11
      ? [server(5193, { DOTNET_ROOT: dirname(dotnet11) }, `"${dotnet11}" "${net11Dll}" --urls http://127.0.0.1:5193`)]
      : []),
  ],
  projects: [
    // Feature specs, every browser.
    ...(matrixOnly ? [] : browsers.map((b) => ({
      name: `quickstart${b === 'chromium' ? '' : `-${b}`}`,
      testMatch: /quickstart\.spec\.ts/,
      use: { ...deviceFor[b as keyof typeof deviceFor], baseURL: 'http://127.0.0.1:5210' },
    }))),
    ...(matrixOnly ? [] : browsers.map((b) => ({
      name: b,
      testIgnore: /(matrix|quickstart|profile|production)\.spec\.ts/,
      use: { ...deviceFor[b as keyof typeof deviceFor], baseURL: 'http://127.0.0.1:5190' },
    }))),
    ...(matrixOnly ? [] : [{ name: 'chromium-subpath', testIgnore: /(matrix|quickstart|profile|production)\.spec\.ts/, metadata: { pathBase: subPath }, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5199' } }]),
    ...(matrixOnly ? [] : [{ name: 'chromium-strict-dynamic', testIgnore: /(matrix|quickstart|profile|production)\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5192' } }]),

    ...(matrixOnly ? [] : [{ name: 'production', testMatch: /production\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5220' } }]),
    // Runtime cost (CDP): leaks, circuit traffic, CPU. Chromium only.
    ...(matrixOnly ? [] : [{ name: 'profile', testMatch: /profile\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5190', trace: 'off' as const } }]),

    // The matrix: every app mode on Chromium, the default mode on every browser, plus strict-dynamic, aspnetcore main
    // and .NET 11 for the default mode.
    ...(Object.keys(appModes) as Array<keyof typeof appModes>).map((m) => matrix(m, 'chromium')),
    ...browsers.filter((b) => b !== 'chromium').map((b) => matrix('enhanced', b as keyof typeof deviceFor)),
    matrix('enhanced', 'chromium', 5192, '-strict-dynamic'),
    matrix('enhanced', 'chromium', 5199, '-subpath', { pathBase: subPath }),
    ...(withClone
      ? [
        { name: 'chromium-aspnetcore-main', testIgnore: /(matrix|quickstart|profile|production)\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5191' } },
        matrix('enhanced', 'chromium', 5191, '-aspnetcore-main', { serverOnly: true }),
      ]
      : []),
    ...(withNet11
      ? [
        { name: 'chromium-net11', testIgnore: /(matrix|quickstart|profile|production)\.spec\.ts/, use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5193' } },
        matrix('enhanced', 'chromium', 5193, '-net11'),
      ]
      : []),
  ],
});
