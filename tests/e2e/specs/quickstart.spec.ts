import { test, expect } from '../fixtures';

// Keeps the QuickStart sample honest: everything its pages promise, under its strict CSP.
test.describe('QuickStart sample', () => {
  test('JS component: static instance draws, interactive instance calls .NET and is called from .NET', async ({ page }) => {
    await page.goto('/js-component');
    const hosts = page.locator('blazor-island[attach]');
    await expect(hosts).toHaveCount(2);
    await page.waitForFunction(() => [...document.querySelectorAll('blazor-island[attach]')].every((e: any) => e.islandState === 'mounted' ));
    await page.waitForFunction(() => document.querySelectorAll('blazor-island[attach]')[1]?.hasAttribute('interactive'));
    await page.waitForFunction(() => (window as any).BlazorIslands.history().some((e: any) => e.type === 'connect'));

    // JS -> .NET
    await page.locator('canvas').nth(1).click({ position: { x: 160, y: 40 } });
    await expect(page.locator('.sparkline-status').nth(1)).toHaveText(/^Point \d+ = \d+ \(handled in \.NET\)$/);

    // Static: JS works, there is no .NET to call
    await page.locator('canvas').nth(0).click({ position: { x: 10, y: 40 } });
    await expect(page.locator('.sparkline-status').nth(0)).toHaveText('Click the chart.');

    // C# -> JS parameters, same instance
    const id = await hosts.nth(1).evaluate((e: any) => e.islandId);
    await page.getByText('Add a point').click();
    await expect.poll(() => hosts.nth(1).evaluate((e: any) => e.islandProps.values.length)).toBe(8);
    expect(await hosts.nth(1).evaluate((e: any) => e.islandId)).toBe(id);

    // C# -> JS method
    await page.getByText('Highlight the first point').click();
    await expect.poll(() => page.evaluate(() => {
      const d = document.querySelectorAll('canvas')[1]!.getContext('2d')!.getImageData(0, 0, 12, 80).data;
      let red = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! > 180 && d[i + 1]! < 80) red++;
      return red;
    })).toBeGreaterThan(0);
  });

  test('island and page script mount, clean up on leave, and remount on return', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="island"]');
    await page.waitForFunction(() => (document.querySelector('blazor-island') as any)?.islandState === 'mounted');
    await page.locator('blazor-island button').click();
    await expect.poll(() => page.evaluate(() => document.querySelector('blazor-island')!.shadowRoot!.textContent!.replace(/\s+/g, ' ').trim())).toBe('Clicks: 11+1');

    await page.click('a[href="page-script"]');
    await expect(page.locator('#page-script-output')).toHaveText(/^Page script mounted at /);
    await page.keyboard.press('k');
    await expect(page.locator('#page-script-output')).toHaveText('You pressed "k".');

    await page.click('a[href="island"]');
    await page.waitForFunction(() => (document.querySelector('blazor-island') as any)?.islandState === 'mounted');
    const report = await page.evaluate(() => (window as any).BlazorIslands.inspect());
    expect(report.problems).toEqual([]);
    expect(report.mounted).toBe(1);
  });

  test('strict CSP with no unsafe keywords', async ({ request }) => {
    const csp = (await request.get('/')).headers()['content-security-policy'];
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9_-]+'(;|$)/);
    expect(csp).not.toContain('unsafe');
  });
});
