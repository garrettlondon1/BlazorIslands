import { test, expect, waitForIsland, lifecycle, islandText, markDocument, sameDocument, enhancedNavigate } from '../fixtures';

test.describe('loading independence', () => {
  test('a slow bundle keeps the fallback while Blazor is already interactive', async ({ page, context }) => {
    await context.addCookies([{ name: 'slow-ms', value: '5000', url: 'http://127.0.0.1' }]);
    const started = Date.now();
    await page.goto('/slow', { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#slow-fallback')).toBeVisible();
    // Blazor booted and the circuit is interactive while the island bundle is still downloading.
    await expect(async () => {
      await page.click('#blazor-counter');
      await expect(page.locator('#blazor-counter')).not.toHaveText('Blazor clicks: 0', { timeout: 1000 });
    }).toPass({ timeout: 4000 });
    expect(await page.evaluate(() => (document.getElementById('slow') as any).islandState)).toBe('loading');

    await waitForIsland(page, 'slow', 'mounted', 20_000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4500);
    await expect(page.locator('#slow [data-testid=slow-hello]')).toHaveText('Hello from the slow island!');
  });

  test('islands mount even if blazor.web.js never loads', async ({ page }) => {
    await page.route(/blazor\.web(\.[a-z0-9]+)?\.js$/, (route) => route.abort());
    await page.goto('/static');
    await waitForIsland(page, 'static-counter');
    await waitForIsland(page, 'clock');
    await page.locator('#static-counter [data-testid=increment]').click();
    await expect(page.locator('#static-counter [data-testid=count]')).toHaveText('11');
  });

  test('Blazor boots and stays interactive even if island bundles never arrive', async ({ page }) => {
    await page.route(/\/islands\/slow-bundle\./, () => { /* never fulfilled */ });
    await page.goto('/slow', { waitUntil: 'domcontentloaded' });
    await expect(async () => {
      await page.click('#blazor-counter');
      await expect(page.locator('#blazor-counter')).not.toHaveText('Blazor clicks: 0', { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.locator('#slow-fallback')).toBeVisible();
  });

  test('a bundle that is still loading when the user navigates away never mounts', async ({ page, context }) => {
    await context.addCookies([{ name: 'slow-ms', value: '2500', url: 'http://127.0.0.1' }]);
    await page.goto('/');
    await markDocument(page);
    await enhancedNavigate(page, 'a[href="slow"]', '/slow');
    await enhancedNavigate(page, 'a[href="static"]', '/static');
    await page.waitForTimeout(3500);
    const slowMounts = (await lifecycle(page)).filter((e) => e.component === 'Hello' && e.type === 'mount');
    expect(slowMounts).toEqual([]);
    expect(await sameDocument(page)).toBe(true);
  });
});

test.describe('failures', () => {
  test('missing modules, unknown components and throwing mounts keep their fallback; others are unaffected', async ({ page }) => {
    await page.goto('/errors');
    await waitForIsland(page, 'healthy');
    for (const id of ['missing-module', 'missing-component', 'throws']) {
      await expect.poll(() => page.evaluate((i) => document.getElementById(i)!.matches(':state(error)'), id)).toBe(true);
      await expect(page.locator(`#${id}-fallback`)).toBeVisible();
    }
    const errors = (await lifecycle(page)).filter((e) => e.type === 'error');
    expect(errors.map((e) => e.error).join('\n')).toContain("has no island named 'NoSuchComponent'");
    expect(errors.map((e) => e.error).join('\n')).toContain('This island throws on purpose.');
    await page.locator('#healthy [data-testid=increment]').click();
    await expect(page.locator('#healthy [data-testid=count]')).toHaveText('2');
  });
});

test.describe('light DOM islands', () => {
  test('shadow="none" renders into the element and survives enhanced navigation to the same page', async ({ page }) => {
    await page.goto('/shadow-none');
    await waitForIsland(page, 'light');
    const before = await islandText(page, 'light');
    expect(await page.locator('#light').evaluate((el) => el.shadowRoot)).toBeNull();
    await expect(page.locator('#light > p.light-island')).toHaveText(/Hello from the light DOM/);

    await markDocument(page);
    await enhancedNavigate(page, '#shadow-none-self', 'again=1');
    await expect(page.locator('#light > p.light-island')).toHaveText(before!);
    expect(await sameDocument(page)).toBe(true);
  });
});

