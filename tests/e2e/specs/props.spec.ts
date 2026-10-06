import { test, expect, waitForIsland, islandId, echo, markDocument, sameDocument, enhancedNavigate, lifecycle } from '../fixtures';

test.describe('props over enhanced navigation', () => {
  test('a query change updates props in place: same instance, update called, state kept', async ({ page }) => {
    await page.goto('/props?n=1');
    await waitForIsland(page, 'echo');
    await markDocument(page);
    const first = await echo(page, 'echo');
    expect(first).toMatchObject({ n: 1, source: 'query', updates: 0 });

    await enhancedNavigate(page, '#next-link', 'n=2');
    await expect.poll(async () => (await echo(page, 'echo')).n).toBe(2);
    const second = await echo(page, 'echo');
    expect(second.id).toBe(first.id);
    expect(second.updates).toBe(1);

    await enhancedNavigate(page, '#next-link', 'n=3');
    await expect.poll(async () => (await echo(page, 'echo')).n).toBe(3);
    expect((await echo(page, 'echo')).id).toBe(first.id);
    expect(await sameDocument(page)).toBe(true);
  });

  test('an enhanced form post renders a new island and updates the existing one', async ({ page }) => {
    await page.goto('/props?n=4');
    await waitForIsland(page, 'echo');
    const before = await islandId(page, 'echo');
    await markDocument(page);

    await page.click('#post-button');
    await waitForIsland(page, 'echo-posted');
    expect(await echo(page, 'echo-posted')).toMatchObject({ n: 40, source: 'form' });
    expect(await islandId(page, 'echo')).toBe(before);
    expect(await sameDocument(page)).toBe(true);
  });

  test('browser back and forward update props through popstate', async ({ page }) => {
    await page.goto('/props?n=1');
    await waitForIsland(page, 'echo');
    const id = await islandId(page, 'echo');
    await enhancedNavigate(page, '#next-link', 'n=2');
    await expect.poll(async () => (await echo(page, 'echo')).n).toBe(2);
    await page.goBack();
    await expect.poll(async () => (await echo(page, 'echo')).n).toBe(1);
    await page.goForward();
    await expect.poll(async () => (await echo(page, 'echo')).n).toBe(2);
    expect(await islandId(page, 'echo')).toBe(id);
  });

  test('leaving the page and coming back mounts a fresh instance', async ({ page }) => {
    await page.goto('/props?n=1');
    await waitForIsland(page, 'echo');
    const id = await islandId(page, 'echo');
    await enhancedNavigate(page, '#other-page-link', '/static');
    await enhancedNavigate(page, 'a[href="props?n=1"]', '/props');
    await waitForIsland(page, 'echo');
    expect(await islandId(page, 'echo')).not.toBe(id);
    const unmounts = (await lifecycle(page)).filter((e) => e.type === 'unmount' && e.src.includes('echo'));
    expect(unmounts.length).toBeGreaterThanOrEqual(1);
  });
});
