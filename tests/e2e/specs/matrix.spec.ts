import type { Page, WebSocketRoute } from '@playwright/test';
import { test, expect, markDocument, sameDocument } from '../fixtures';

/*
 * The combinatorial suite: every page kind x every way of arriving at it x every app mode (one Playwright project per
 * app mode, see playwright.config.ts). After every step the same invariants are asserted, so a pass means islands and
 * page scripts behave as they would on a plain full page load, however Blazor got there:
 *
 *   - the probe island is mounted exactly once for this visit (never double-mounted, never left behind),
 *   - prerendered interactive pages hand the island to the re-rendered element instead of mounting it twice,
 *   - the island's props reflect the renderer that finally owns the page (Static, Server or WebAssembly),
 *   - the page script ran exactly once for this visit and its DOM changes are visible,
 *   - BlazorIslands.inspect() reports no problems (no leaks, no orphans, no nesting, counters consistent),
 *   - interactive pages: .NET -> island props updates keep the same instance, island -> .NET events arrive,
 *     .NET -> JS interop reaches the page script's globals,
 *   - leaving the page unmounts the island and the page script,
 *   - zero CSP violations and zero uncaught errors (fixture).
 */

type AppMode = 'enhanced' | 'no-enhanced-nav' | 'no-dom-preservation' | 'global-server' | 'global-wasm' | 'global-auto';

const interactiveKinds = new Set(['server', 'server-np', 'wasm', 'wasm-np', 'auto', 'auto-np']);
const prerenderedKinds = new Set(['server', 'wasm', 'auto']);
const serverKinds = new Set(['server', 'server-np']);

function appModeOf(): AppMode {
  return (test.info().project.metadata?.appMode ?? 'enhanced') as AppMode;
}

const isGlobal = (m: AppMode) => m.startsWith('global-');
/** Whether clicking a link keeps the document (enhanced navigation or an interactive router) or loads a new one. */
const linksKeepDocument = (m: AppMode) => m === 'enhanced' || isGlobal(m);

function kindsFor(mode: AppMode): string[] {
  return isGlobal(mode) ? ['inherit'] : ['static', 'stream', 'server', 'server-np', 'wasm', 'wasm-np', 'auto', 'auto-np'];
}

function isInteractive(kind: string, mode: AppMode) {
  return isGlobal(mode) || interactiveKinds.has(kind);
}

function isPrerenderedInteractive(kind: string, mode: AppMode) {
  return isGlobal(mode) || prerenderedKinds.has(kind);
}

function isServerBacked(kind: string, mode: AppMode) {
  return mode === 'global-server' || (!isGlobal(mode) && serverKinds.has(kind));
}

interface Before {
  history: number;
  pageMounts: number;
  pageUnmounts: number;
  pageUpdatesAtLeave: number;
}

/**
 * Waits until no island is loading or waiting for handoff, so the ledger is stable: an island removed by the last
 * navigation unmounts after a short handoff window, and must not be counted against the next visit.
 */
async function settle(page: Page) {
  await page.waitForFunction(() => {
    const r = (window as any).BlazorIslands?.inspect();
    return !!r && r.orphaned === 0 && r.loading === 0;
  }, null, { timeout: 30_000 });
}

async function before(page: Page): Promise<Before> {
  await settle(page);
  await markDocument(page);
  return page.evaluate(() => {
    const w = window as any;
    return {
      history: w.BlazorIslands?.history().length ?? 0,
      pageMounts: w.__probePage?.mounts ?? 0,
      pageUnmounts: w.__probePage?.unmounts ?? 0,
      pageUpdatesAtLeave: w.__probePage?.pageUpdates ?? 0,
    };
  });
}

async function report(page: Page) {
  return page.evaluate(() => (window as any).BlazorIslands.inspect());
}

async function expectHealthy(page: Page) {
  const r = await report(page);
  expect(r.problems, 'BlazorIslands.inspect() problems').toEqual([]);
  expect(r.ok).toBe(true);
}

/**
 * On failure, attaches the island ledger and Blazor's lifecycle to the test and appends their tail to the error, so a
 * red cell in the matrix explains itself without re-running anything.
 */
async function explained<T>(page: Page, label: string, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    const trail = await page.evaluate(() => {
      const w = window as any;
      return {
        url: location.href,
        history: (w.BlazorIslands?.history() ?? []).map((e: any) => `${e.type} ${e.key} #${e.id}${e.error ? ' ' + e.error : ''}`),
        blazor: (w.BlazorIslands?.blazor() ?? []).map((e: any) => e.type),
        report: w.BlazorIslands?.inspect(),
        pageScript: w.__probePage ? JSON.parse(w.__probePage.describe()) : null,
      };
    }).catch(() => null);
    if (trail) {
      await test.info().attach(`${label}: islands ledger`, { body: JSON.stringify(trail, null, 2), contentType: 'application/json' });
      (error as Error).message += `\n\n[${label}] ${trail.url}\nBlazor: ${trail.blazor.join(' → ')}\nPage script: ${JSON.stringify(trail.pageScript)}\nLast island events:\n  ${trail.history.slice(-12).join('\n  ')}`;
    }
    throw error;
  }
}

/** Asserts everything a visit to /m/{kind} must guarantee. `prev` is null when the visit is a fresh document. */
async function expectVisit(page: Page, kind: string, prev: Before | null) {
  return explained(page, `visit ${kind}`, () => expectVisitCore(page, kind, prev));
}

async function expectVisitCore(page: Page, kind: string, prev: Before | null) {
  const mode = appModeOf();
  const same = prev !== null && (await sameDocument(page));
  const historyStart = same ? prev!.history : 0;
  const pageMountsBefore = same ? prev!.pageMounts : 0;
  const interactive = isInteractive(kind, mode);

  await expect(page.locator('#matrix-title')).toHaveText(`Matrix: ${kind}`);
  await page.waitForFunction(
    ({ interactive, kind }) => {
      const el = document.getElementById('probe-island') as any;
      const probe = document.getElementById('probe');
      if (!el || el.islandState !== 'mounted' || !probe) {
        return false;
      }
      if (interactive) {
        return probe.dataset.interactive === 'true' && el.islandProps?.interactive === true;
      }
      if (kind === 'stream') {
        return document.getElementById('stream-phase')?.textContent === 'streamed' && el.islandProps?.kind === 'stream';
      }
      return true;
    },
    { interactive, kind },
    { timeout: 30_000 },
  );

  // The page script module may resolve a moment after the island's: wait for both, then for the ledger to settle.
  await expect.poll(() => page.evaluate(() => (window as any).__probePage?.mounts ?? 0), { message: 'page script mounts' }).toBe(pageMountsBefore + 1);
  await settle(page);

  if (interactive) {
    // The JS component is connected to its .NET component once interactive.
    await page.waitForFunction(() => {
      const host = document.querySelector('#probe blazor-island[attach]');
      return !!host && host.hasAttribute('interactive');
    }, null, { timeout: 30_000 });
  }

  const widget = await page.evaluate(({ historyStart, kind }) => {
    const w = window as any;
    const key = `m/${kind}|js:Matrix/ProbeWidget.razor.js#`;
    const all = w.BlazorIslands.history().slice(historyStart).filter((e: any) => e.key === key);
    const ids = new Set(all.filter((e: any) => e.type === 'mount').map((e: any) => e.id));
    const events = all.filter((e: any) => ids.has(e.id));
    const host = document.querySelector('#probe blazor-island[attach]') as any;
    return {
      mounts: events.filter((e: any) => e.type === 'mount').length,
      unmounts: events.filter((e: any) => e.type === 'unmount').length,
      handoffs: events.filter((e: any) => e.type === 'handoff').length,
      props: host?.islandProps,
      state: host?.islandState,
    };
  }, { historyStart, kind });
  expect(widget.state, 'JS component state').toBe('mounted');
  expect(widget.mounts, 'JS component instances this visit').toBe(1);
  expect(widget.unmounts, 'JS component unmounts this visit').toBe(0);
  expect(widget.props, 'JS component parameters (camelCase)').toMatchObject({ label: kind, count: 0 });
  if (isPrerenderedInteractive(kind, mode) && !(isGlobal(mode) && same)) {
    expect(widget.handoffs, 'JS component handed over from the prerendered markup').toBeGreaterThanOrEqual(1);
  }

  const state = await page.evaluate(({ historyStart, kind }) => {
    const w = window as any;
    const key = `m/${kind}|probe`;
    const all = w.BlazorIslands.history().slice(historyStart).filter((e: any) => e.key === key);
    // Only instances created during this visit; a previous visit's instance with the same key may still be unmounting.
    const ids = new Set(all.filter((e: any) => e.type === 'mount').map((e: any) => e.id));
    const events = all.filter((e: any) => ids.has(e.id));
    const el = document.getElementById('probe-island') as any;
    return {
      mounts: events.filter((e: any) => e.type === 'mount').length,
      unmounts: events.filter((e: any) => e.type === 'unmount').length,
      handoffs: events.filter((e: any) => e.type === 'handoff').length,
      live: w.BlazorIslands.inspect().instances.filter((i: any) => i.key === key && i.state === 'mounted').length,
      props: el.islandProps,
      renderer: document.getElementById('probe')!.dataset.renderer,
      pageMounts: w.__probePage?.mounts ?? 0,
    };
  }, { historyStart, kind });

  expect(state.mounts, 'probe island mounts this visit').toBe(1);
  expect(state.unmounts, 'probe island unmounts this visit').toBe(0);
  expect(state.live, 'live probe instances').toBe(1);
  if (isPrerenderedInteractive(kind, mode) && !(isGlobal(mode) && same)) {
    // The interactive renderer re-created the prerendered DOM; the island must have been handed over, not remounted.
    expect(state.handoffs, 'handoffs from the prerendered element').toBeGreaterThanOrEqual(1);
  }
  expect(state.props.renderer, 'island props come from the final renderer').toBe(state.renderer);
  expect(state.props.interactive).toBe(interactive);
  if (interactive) {
    expect(['Server', 'WebAssembly']).toContain(state.renderer);
  } else {
    expect(state.renderer).toBe('Static');
  }

  // The page script ran exactly once for this visit, and what it wrote to the page is visible.
  expect(state.pageMounts, 'page script mounts').toBe(pageMountsBefore + 1);
  await expect(page.locator('#probe-js')).toHaveText(`Page script ran: mount ${pageMountsBefore + 1}, path /m/${kind}`);

  await expectHealthy(page);
}

/** Exercises the page the way a user and the app would, then re-checks the invariants. */
async function expectWorking(page: Page, kind: string) {
  return explained(page, `exercise ${kind}`, () => expectWorkingCore(page, kind));
}

async function expectWorkingCore(page: Page, kind: string) {
  const mode = appModeOf();
  const island = page.locator('#probe-island');
  const id = await island.evaluate((el: any) => el.islandId);

  await island.locator('[data-testid=probe-click]').click();
  await expect.poll(() => island.evaluate((el: any) => JSON.parse(el.shadowRoot.querySelector('output').textContent).clicks)).toBe(1);

  if (isInteractive(kind, mode)) {
    // Island -> .NET event.
    await expect(page.locator('#probe-events')).toHaveText('Island events: 1');
    // .NET -> island props, in place.
    await page.click('#probe-increment');
    await expect.poll(() => island.evaluate((el: any) => el.islandProps.count)).toBe(1);
    // .NET -> page JavaScript through IJSRuntime.
    await page.click('#probe-call-js');
    await expect(page.locator('#probe-js-result')).toContainText(`"path":"/m/${kind}"`);
  }

  // The JS component: JS state, refs, JS -> .NET, .NET -> JS (with an ElementReference), and render hooks.
  const widgetHost = page.locator('#probe blazor-island[attach]');
  const widgetId = await widgetHost.evaluate((el: any) => el.islandId);
  const widgetCount = page.locator('[data-ref="js-count"]');
  const before = Number(await widgetCount.textContent());
  await page.click('#widget-js-click');
  await page.click('#widget-js-click');
  await expect(widgetCount).toHaveText(String(before + 2));
  if (isInteractive(kind, mode)) {
    await expect(page.locator('#widget-net-count')).toHaveText(`.NET saw ${before + 2} JS click(s)`);
    await page.click('#widget-call-js');
    await expect(page.locator('#widget-js-answer')).toContainText(`label ${kind}, count 1, clicks ${before + 2}`);
    await page.click('#widget-flash');
    await expect(page.locator('#widget-js-answer')).toHaveText('flashed input#widget-input value=ref-target');
    // .NET re-rendered the component several times; JS-owned state survived and parameters flowed in.
    await expect(widgetCount).toHaveText(String(before + 2));
    await expect.poll(() => widgetHost.evaluate((el: any) => el.islandProps.count)).toBe(1);
  } else {
    // Statically rendered: there is no .NET to call, and saying so is the correct behavior.
    await expect(page.locator('#widget-net-count')).toHaveText('.NET saw 0 JS click(s)');
  }
  expect(await widgetHost.evaluate((el: any) => el.islandId)).toBe(widgetId);

  // Same instance, local state intact.
  expect(await island.evaluate((el: any) => el.islandId)).toBe(id);
  await expect.poll(() => island.evaluate((el: any) => JSON.parse(el.shadowRoot.querySelector('output').textContent).clicks)).toBe(1);
  await expectHealthy(page);
}

async function click(page: Page, selector: string) {
  await page.click(selector);
}

async function expectHub(page: Page) {
  await expect(page.locator('#hub')).toBeVisible();
  await page.waitForFunction(() => (document.getElementById('hub-island') as any)?.islandState === 'mounted', null, { timeout: 30_000 });
  if (isGlobal(appModeOf())) {
    // Global interactivity means the router runs in .NET; before it starts, Blazor serves links with enhanced
    // navigation instead. Navigate from an interactive router (the "early click" test covers the other case).
    await expect(page.locator('#hub-renderer')).not.toHaveText('Static', { timeout: 30_000 });
  }
}

/**
 * blazor.web.js from an aspnetcore clone (the next major) cannot boot this build's WebAssembly runtime; mixing versions is
 * unsupported, so that project covers the static, streaming and Server pages. Called inside each test: a describe-level
 * test.skip(callback) would apply to every test in the group, not just this kind.
 */
function skipUnsupported(kind: string) {
  test.skip(!!test.info().project.metadata?.serverOnly && (kind.startsWith('wasm') || kind.startsWith('auto')), 'WebAssembly needs matching blazor.web.js and runtime versions.');
}

for (const mode of ['enhanced', 'no-enhanced-nav', 'no-dom-preservation', 'global-server', 'global-wasm', 'global-auto'] as AppMode[]) {
  test.describe(`matrix ${mode}`, () => {
    test.skip(() => appModeOf() !== mode, 'Runs in the project for its app mode.');

    for (const kind of kindsFor(mode)) {
      test(`${kind} · full load`, async ({ page }) => {
        skipUnsupported(kind);
        await page.goto(`/m/${kind}`);
        await expectVisit(page, kind, null);
        await expectWorking(page, kind);
      });

      test(`${kind} · navigate in`, async ({ page }) => {
        skipUnsupported(kind);
        await page.goto('/m');
        await expectHub(page);
        const prev = await before(page);
        await click(page, `#to-${kind}`);
        await expectVisit(page, kind, prev);
        expect(await sameDocument(page)).toBe(linksKeepDocument(mode));
        await expectWorking(page, kind);
      });

      test(`${kind} · navigate away`, async ({ page }) => {
        skipUnsupported(kind);
        await page.goto(`/m/${kind}`);
        await expectVisit(page, kind, null);
        const prev = await before(page);
        const id = await page.locator('#probe-island').evaluate((el: any) => el.islandId);
        await click(page, '#to-hub');
        await expectHub(page);
        if (await sameDocument(page)) {
          // Same document: the island and the page script must have been torn down, not left running.
          await expect.poll(() => page.evaluate((i) => (window as any).BlazorIslands.history().some((e: any) => e.type === 'unmount' && e.id === i), id)).toBe(true);
          await expect.poll(() => page.evaluate(() => (window as any).__probePage.unmounts)).toBe(prev.pageUnmounts + 1);
          // The departing page script was never told about the page that replaced it, and its listeners are gone.
          const leftBehind = await page.evaluate(() => {
            const w = window as any;
            const before = w.__probePage.clicks;
            document.dispatchEvent(new CustomEvent('probe-ping'));
            return { pageUpdatesAfterLeaving: w.__probePage.pageUpdates, pingsHandled: w.__probePage.clicks - before };
          });
          expect(leftBehind.pingsHandled, 'page script listener still attached after leaving').toBe(0);
          expect(leftBehind.pageUpdatesAfterLeaving, 'page script got an update for the page that replaced it').toBe(prev.pageUpdatesAtLeave);
          const leftovers = await page.evaluate((k) => (window as any).BlazorIslands.inspect().instances.filter((i: any) => i.key.startsWith(k)), `m/${kind}|`);
          expect(leftovers).toEqual([]);
        }
        await expectHealthy(page);
      });

      test(`${kind} · same page again`, async ({ page }) => {
        skipUnsupported(kind);
        await page.goto(`/m/${kind}`);
        await expectVisit(page, kind, null);
        const prev = await before(page);
        const id = await page.locator('#probe-island').evaluate((el: any) => el.islandId);
        await click(page, '#to-self');
        await page.waitForURL(/again=1/);
        if (linksKeepDocument(mode)) {
          await page.waitForTimeout(400);
          expect(await sameDocument(page)).toBe(true);
          // Same page: the island and page script keep running, and the page script's DOM changes survive the update.
          expect(await page.locator('#probe-island').evaluate((el: any) => el.islandId)).toBe(id);
          expect(await page.evaluate(() => (window as any).__probePage.mounts)).toBe(prev.pageMounts);
          await expect(page.locator('#probe-js')).toHaveText(`Page script ran: mount ${prev.pageMounts}, path /m/${kind}`);
          await expectHealthy(page);
        } else {
          await expectVisit(page, kind, null);
        }
        await expectWorking(page, kind);
      });

      test(`${kind} · round trip`, async ({ page }) => {
        skipUnsupported(kind);
        await page.goto(`/m/${kind}`);
        await expectVisit(page, kind, null);
        await click(page, '#to-hub');
        await expectHub(page);
        const prev = await before(page);
        await click(page, `#to-${kind}`);
        await expectVisit(page, kind, prev);
        await expectWorking(page, kind);
      });

      test(`${kind} · back and forward`, async ({ page }) => {
        skipUnsupported(kind);
        await page.goto('/m');
        await expectHub(page);
        const atHub = await before(page);
        await click(page, `#to-${kind}`);
        await expectVisit(page, kind, atHub);
        await click(page, '#to-hub');
        await expectHub(page);
        const prev = await before(page);
        await page.goBack();
        await expectVisit(page, kind, prev);
        await page.goForward();
        await expectHub(page);
        await expectHealthy(page);
      });

      if (isGlobal(mode)) {
        test(`${kind} · early click (before the router is interactive)`, async ({ page }) => {
        skipUnsupported(kind);
          await page.goto('/m');
          await expect(page.locator('#hub')).toBeVisible();
          await page.waitForFunction(() => (document.getElementById('hub-island') as any)?.islandState === 'mounted');
          const prev = await before(page);
          // Click while Blazor is still starting: enhanced navigation or the router, whichever owns the click.
          await click(page, `#to-${kind}`);
          await page.waitForURL((url) => url.pathname.endsWith(`/m/${kind}`));
          await page.waitForFunction(() => document.getElementById('matrix-title') || document.getElementById('hub'));
          await page.waitForTimeout(1500);
          await settle(page);
          if (await page.locator('#matrix-title').count() === 0 && await page.locator('#hub').count() > 0) {
            // Blazor's interactive router finished booting while the enhanced navigation for this click was in flight,
            // and rendered the route it was prerendered at instead of the URL. That is a framework routing race; the
            // islands must still be exactly right for the page Blazor shows.
            test.info().annotations.push({ type: 'framework-race', description: `URL is /m/${kind} but Blazor's router shows the hub (router booted during the enhanced navigation).` });
            await expectHub(page);
            const live = await page.evaluate(() => (window as any).BlazorIslands.inspect().instances.map((i: any) => i.key));
            expect(live.filter((k: string) => k.includes(`m/${kind}|`) || k.includes(`@/m/${kind}`)), 'no islands left from the page that is not shown').toEqual([]);
            await expectHealthy(page);
            return;
          }
          await expectVisit(page, kind, prev);
          await expectWorking(page, kind);
        });
      }

      test(`${kind} · reload`, async ({ page }) => {
        skipUnsupported(kind);
        await page.goto(`/m/${kind}`);
        await expectVisit(page, kind, null);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expectVisit(page, kind, null);
        await expectWorking(page, kind);
      });

      if (isServerBacked(kind, mode)) {
        test(`${kind} · websocket drop and reconnect`, async ({ page }) => {
        skipUnsupported(kind);
          const sockets: WebSocketRoute[] = [];
          await page.routeWebSocket(/\/_blazor/, (ws) => {
            ws.connectToServer();
            sockets.push(ws);
          });
          await page.goto(`/m/${kind}`);
          await expectVisit(page, kind, null);
          const id = await page.locator('#probe-island').evaluate((el: any) => el.islandId);

          await sockets.at(-1)!.close({ code: 4000, reason: 'e2e drop' });
          await expect.poll(() => page.evaluate(() => (window as any).BlazorIslands.blazor().map((e: any) => e.type))).toContain('circuit-down');
          // The island keeps running while the circuit is down.
          expect(await page.locator('#probe-island').evaluate((el: any) => el.islandState)).toBe('mounted');
          await expect.poll(() => page.evaluate(() => (window as any).BlazorIslands.blazor().map((e: any) => e.type)), { timeout: 20_000 }).toContain('circuit-up');

          // Same island, and the reconnected circuit still drives it.
          expect(await page.locator('#probe-island').evaluate((el: any) => el.islandId)).toBe(id);
          await expectWorking(page, kind);
        });
      }
    }
  });
}
