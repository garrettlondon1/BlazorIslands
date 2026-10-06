import { test, expect, waitForIsland, islandId, lifecycle, markDocument, sameDocument, enhancedNavigate } from '../fixtures';

async function waitForCircuit(page: import('@playwright/test').Page) {
  // The interactive button only works once the circuit is up; clicking proves it.
  await expect(async () => {
    const before = await page.locator('#server-start').textContent();
    await page.click('#server-increment');
    await expect(page.locator('#server-start')).not.toHaveText(before!, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

test.describe('Interactive Server', () => {
  test('island events reach the component through OnEvent', async ({ page }) => {
    await page.goto('/interactive');
    await waitForIsland(page, 'interactive-counter');
    await waitForCircuit(page);

    const island = page.locator('#interactive-counter');
    // waitForCircuit's click changed the server value; wait until that props update has reached the island.
    const serverStart = Number((await page.locator('#server-start').textContent())!.replace('Start: ', ''));
    await expect(island.locator('[data-testid=count]')).toHaveText(String(serverStart));
    const start = serverStart;
    await island.locator('[data-testid=increment]').click();
    await expect(page.locator('#events-received')).toHaveText(`Events received: 1 (last: incremented:${start + 1})`);
    await island.locator('[data-testid=increment]').click();
    await expect(page.locator('#events-received')).toHaveText(`Events received: 2 (last: incremented:${start + 2})`);
  });

  test('server re-renders push new props into the same island instance', async ({ page }) => {
    await page.goto('/interactive');
    await waitForIsland(page, 'interactive-counter');
    await waitForCircuit(page);
    const id = await islandId(page, 'interactive-counter');
    const startText = await page.locator('#server-start').textContent();
    const start = Number(startText!.replace('Start: ', ''));

    await page.click('#server-increment');
    await expect(page.locator('#interactive-counter [data-testid=note]')).toHaveText(`Server says ${start + 1}`);
    await expect(page.locator('#interactive-counter [data-testid=count]')).toHaveText(String(start + 1));
    expect(await islandId(page, 'interactive-counter')).toBe(id);
  });

  test('removing the island from the render tree unmounts it; adding it back mounts a new one', async ({ page }) => {
    await page.goto('/interactive');
    await waitForIsland(page, 'interactive-counter');
    await waitForCircuit(page);
    const id = await islandId(page, 'interactive-counter');

    await page.click('#toggle-island');
    await expect(page.locator('#interactive-counter')).toHaveCount(0);
    await expect.poll(async () => (await lifecycle(page)).some((e) => e.type === 'unmount' && e.id === id)).toBe(true);

    await page.click('#toggle-island');
    await waitForIsland(page, 'interactive-counter');
    expect(await islandId(page, 'interactive-counter')).not.toBe(id);
  });

  test('works after arriving by enhanced navigation from a static page', async ({ page }) => {
    await page.goto('/static');
    await waitForIsland(page, 'static-counter');
    await markDocument(page);
    await enhancedNavigate(page, 'a[href="interactive"]', '/interactive');
    await waitForIsland(page, 'interactive-counter');
    await waitForCircuit(page);
    await page.locator('#interactive-counter [data-testid=increment]').click();
    await expect(page.locator('#events-received')).toContainText('Events received: 1');
    expect(await sameDocument(page)).toBe(true);
  });
});
