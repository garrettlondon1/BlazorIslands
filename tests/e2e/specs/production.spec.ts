import type { CDPSession, Page } from '@playwright/test';
import { test, expect, waitForIsland } from '../fixtures';

/**
 * Static-asset delivery in a published, Production app: what a Blazor developer gets from MapStaticAssets plus
 * <IslandsHead>/<IslandBundle> without configuring anything. Chromium (CDP network events).
 */

const pages: Array<{ path: string; island: string }> = [
  { path: '/react-app', island: 'cart-summary' },
  { path: '/preact-tsx', island: 'todo' },
  { path: '/react', island: 'chart' },
  { path: '/static', island: 'static-counter' },
  { path: '/frameworks/vue', island: 'static-card' },
  { path: '/frameworks/svelte', island: 'static-card' },
  { path: '/frameworks/solid', island: 'static-card' },
  { path: '/frameworks/feliz', island: 'static-card' },
  { path: '/m/wasm', island: 'probe-island' },
];

interface Row {
  url: string;
  path: string;
  status: number;
  type: string;
  cacheControl: string;
  encoding: string;
  csp: boolean;
  bytes: number;
  fromCache: boolean;
}

async function record(page: Page): Promise<{ cdp: CDPSession; rows: Map<string, Row> }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  const rows = new Map<string, Row>();
  cdp.on('Network.responseReceived', (e) => {
    const h = Object.fromEntries(Object.entries(e.response.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
    rows.set(e.requestId, {
      url: e.response.url,
      path: new URL(e.response.url).pathname,
      status: e.response.status,
      type: e.type,
      cacheControl: h['cache-control'] ?? '',
      encoding: h['content-encoding'] ?? '',
      csp: 'content-security-policy' in h,
      bytes: 0,
      fromCache: !!(e.response.fromDiskCache || e.response.fromPrefetchCache || e.response.fromServiceWorker),
    });
  });
  cdp.on('Network.loadingFinished', (e) => {
    const row = rows.get(e.requestId);
    if (row) {
      row.bytes = e.encodedDataLength;
    }
  });
  return { cdp, rows };
}

async function tour(page: Page) {
  for (const p of pages) {
    await page.goto(p.path);
    await waitForIsland(page, p.island, 'mounted', 30_000);
  }
  // The last page boots WebAssembly; let the runtime finish downloading before the tour counts as done.
  await page.locator('#probe[data-interactive=true]').waitFor({ timeout: 60_000 });
  await page.waitForLoadState('networkidle');
}

const assets = (rows: Map<string, Row>) =>
  [...rows.values()].filter((r) => r.type !== 'Document' && r.type !== 'WebSocket' && !/\/_blazor/.test(r.path) && r.status !== 204);

// Files the app references by fixed name, by design: the favicon link in the template.
const unfingerprintedByDesign = /^\/favicon\.png$/;

test.describe('published app: static assets', () => {
  test('every asset is fingerprinted, immutable, compressed and downloaded once', async ({ page }, info) => {
    const preloadWarnings: string[] = [];
    page.on('console', (m) => {
      // A preload the browser can't use (integrity, credentials or `as` mismatch) is wasted work, and the module is
      // fetched again when the island imports it.
      if (/preload/i.test(m.text()) && /not used|mismatch/i.test(m.text())) {
        preloadWarnings.push(m.text());
      }
    });
    const { rows } = await record(page);
    await tour(page);
    // Chrome reports unused preloads a few seconds after load.
    await page.waitForTimeout(3500);
    expect(preloadWarnings).toEqual([]);
    const list = assets(rows);
    const report = list.map((r) => `${r.status} ${r.bytes}B ${r.encoding || '-'} ${r.cacheControl} ${r.path}`);
    await info.attach('cold.txt', { body: report.join('\n'), contentType: 'text/plain' });

    const problems: string[] = [];
    const downloads = new Map<string, number>();
    for (const r of list) {
      if (r.status !== 200) {
        problems.push(`${r.status} ${r.path}`);
        continue;
      }
      if (unfingerprintedByDesign.test(r.path)) {
        continue;
      }
      if (!/\.[a-zA-Z0-9]{5,}\.[a-z0-9.]+$/.test(r.path)) {
        problems.push(`not fingerprinted: ${r.path}`);
      }
      if (!/immutable/.test(r.cacheControl) || !/max-age=31536000/.test(r.cacheControl)) {
        problems.push(`not cached immutably (${r.cacheControl}): ${r.path}`);
      }
      // Already-compressed formats are left alone by the SDK, as they should be.
      if (/\.(m?js|css|json|dll|wasm|dat|pdb|map)$/.test(r.path) && !/^(br|gzip)$/.test(r.encoding)) {
        problems.push(`not compressed (${r.encoding || 'identity'}): ${r.path}`);
      }
      if (r.csp) {
        problems.push(`CSP header on a static asset: ${r.path}`);
      }
      if (r.bytes > 0 && !r.fromCache) {
        downloads.set(r.path, (downloads.get(r.path) ?? 0) + 1);
      }
    }
    for (const [path, n] of downloads) {
      if (n > 1) {
        problems.push(`downloaded ${n} times: ${path}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test('a returning visitor downloads no assets at all', async ({ page }, info) => {
    await tour(page);
    const { rows } = await record(page);
    await tour(page);
    const transferred = assets(rows).filter((r) => r.bytes > 0 && !r.fromCache);
    await info.attach('warm.txt', { body: transferred.map((r) => `${r.bytes}B ${r.path}`).join('\n'), contentType: 'text/plain' });
    expect(transferred.map((r) => r.path)).toEqual([]);
  });

  test('documents carry the policy, are never cached, and every module is pinned by SRI', async ({ page, request }) => {
    const response = await request.get('/react-app');
    expect(response.headers()['cache-control']).toContain('no-store');
    const csp = response.headers()['content-security-policy'];
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    const html = await response.text();
    for (const tag of html.match(/<(script|link rel="modulepreload")[^>]*>/g) ?? []) {
      expect(tag, tag).toContain(`nonce="${nonce}"`);
    }
    const map = JSON.parse(/<script type="importmap"[^>]*>([\s\S]*?)<\/script>/.exec(html)![1]) as {
      imports: Record<string, string>;
      integrity: Record<string, string>;
    };
    const unpinned = Object.entries(map.imports)
      .filter(([, url]) => url.startsWith('./') && !map.integrity[url])
      .map(([specifier]) => specifier);
    expect(unpinned).toEqual([]);
    for (const specifier of ['@blazor-islands/client', 'preact', 'preact/hooks', '@preact/signals', 'htm/preact']) {
      expect(map.imports[specifier], specifier).toMatch(/\.[a-z0-9]{10}\.m?js$/);
    }

    // Islands work in the published app under that policy (the fixture fails on CSP violations).
    await page.goto('/react-app');
    await waitForIsland(page, 'cart-summary');
  });
});
