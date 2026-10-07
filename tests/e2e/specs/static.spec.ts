import { test, expect, waitForIsland, islandText, lifecycle, markDocument, sameDocument, enhancedNavigate } from '../fixtures';

test.describe('static SSR', () => {
  test('mounts htm, plain-module and page-script islands on a full page load', async ({ page }) => {
    await page.goto('/static');
    await waitForIsland(page, 'static-counter');
    await waitForIsland(page, 'clock');

    await expect(page.locator('#static-counter [data-testid=count]')).toHaveText('10');
    await expect(page.locator('#static-counter [data-testid=note]')).toHaveText('Rendered with htm');
    await expect(page.locator('#clock [data-testid=time]')).toContainText('UTC');
    await expect(page.locator('#page-script-status')).toHaveText(/Page script mounted \(1 mount/);

    // The server-rendered fallback is still in the light DOM but no longer slotted.
    expect(await page.locator('#static-counter >> css=p.fallback').count()).toBe(1);
    expect(await page.locator('#static-counter').evaluate((el) => el.shadowRoot?.querySelector('slot'))).toBeNull();
  });

  test('island state lives in the island: clicks are local and do not touch the server', async ({ page }) => {
    await page.goto('/static');
    await waitForIsland(page, 'static-counter');
    const counter = page.locator('#static-counter');
    await counter.locator('[data-testid=increment]').click();
    await counter.locator('[data-testid=increment]').click();
    await expect(counter.locator('[data-testid=count]')).toHaveText('12');
  });

  test('custom element states expose mount status to CSS', async ({ page }) => {
    await page.goto('/static');
    await waitForIsland(page, 'static-counter');
    expect(await page.locator('#static-counter').evaluate((el) => el.matches(':state(mounted)'))).toBe(true);
  });

  test('navigating away unmounts every island and runs all cleanup; coming back remounts', async ({ page }) => {
    await page.goto('/static');
    await waitForIsland(page, 'clock');
    await markDocument(page);

    await enhancedNavigate(page, 'a[href="react"]', '/react');
    expect(await sameDocument(page)).toBe(true);

    // Removed islands unmount after the short handoff window, not synchronously with the DOM merge.
    await expect.poll(async () => (await lifecycle(page)).filter((e) => e.type === 'unmount').map((e) => e.src.split('/').pop()!.split('.')[0]))
      .toEqual(expect.arrayContaining(['counter', 'clock', 'StaticIslands']));

    // The clock's interval was cleared: nothing ticks after unmount.
    await page.waitForTimeout(800);
    const clock = await page.evaluate(() => (globalThis as any).__clock);
    expect(clock.unmounts).toBe(1);
    expect(clock.ticksAfterUnmount).toBe(0);
    const pageScript = await page.evaluate(() => (globalThis as any).__pageScript);
    expect(pageScript.unmounts).toBe(1);

    await enhancedNavigate(page, 'a[href="static"]', '/static');
    await waitForIsland(page, 'clock');
    expect(await sameDocument(page)).toBe(true);
    expect(await page.evaluate(() => (globalThis as any).__clock.mounts)).toBe(2);
    await expect(page.locator('#page-script-status')).toHaveText(/Page script mounted \(2 mount/);
  });

  test('a page script stays mounted across enhanced updates of the same page and re-applies its DOM', async ({ page }) => {
    await page.goto('/static');
    await expect(page.locator('#page-script-status')).toHaveText(/1 mount\(s\), 0 page update/);
    await markDocument(page);

    // Same path, different query: Blazor patches the page; the page script must not remount.
    await page.evaluate(() => (window as any).Blazor.navigateTo('static?again=1'));
    await page.waitForURL(/again=1/);
    await expect(page.locator('#page-script-status')).toHaveText(/1 mount\(s\), 1 page update/);
    expect(await sameDocument(page)).toBe(true);
    expect(await page.evaluate(() => (globalThis as any).__pageScript.unmounts)).toBe(0);
  });

  test('islands start from the shadow root without any inline script in the page', async ({ page }) => {
    const response = await page.goto('/static');
    const html = await response!.text();
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>/g)].map((m) => m[1]);
    // The only inline script is the import map, which carries the nonce.
    expect(inlineScripts).toHaveLength(1);
    expect(inlineScripts[0]).toContain('type="importmap"');
    expect(inlineScripts[0]).toMatch(/nonce="[^"]+"/);
    expect(await islandText(page, 'static-counter')).not.toBeNull();
  });
});
