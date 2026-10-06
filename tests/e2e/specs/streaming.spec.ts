import { test, expect, waitForIsland, islandId, echo, markDocument, sameDocument, enhancedNavigate } from '../fixtures';

test.describe('streaming rendering', () => {
  for (const mode of ['full load', 'enhanced navigation'] as const) {
    test(`streamed props update the mounted island in place (${mode})`, async ({ page }) => {
      if (mode === 'full load') {
        await page.goto('/streaming');
      } else {
        await page.goto('/');
        await markDocument(page);
        await enhancedNavigate(page, 'a[href="streaming"]', '/streaming');
      }

      // The first batch arrives before the stream finishes: the island mounts with the initial props...
      await waitForIsland(page, 'stream-echo');
      const initial = await echo(page, 'stream-echo');

      // ...then the streamed batch patches the same element with new props.
      await expect(page.locator('#stream-status')).toHaveText('Stream complete.');
      await expect.poll(async () => (await echo(page, 'stream-echo')).source).toBe('streamed');
      const streamed = await echo(page, 'stream-echo');
      expect(streamed.id).toBe(initial.id);
      expect(streamed.n).toBe(2);

      // An island that only exists in the streamed batch mounts too.
      await waitForIsland(page, 'streamed-counter');
      await expect(page.locator('#streamed-counter [data-testid=count]')).toHaveText('100');

      if (mode === 'enhanced navigation') {
        expect(await sameDocument(page)).toBe(true);
      }
    });
  }

  test('navigating away mid-stream does not mount islands from the abandoned stream', async ({ page }) => {
    await page.goto('/');
    await page.click('a[href="streaming"]');
    await waitForIsland(page, 'stream-echo');
    const streamingId = await islandId(page, 'stream-echo');
    await enhancedNavigate(page, 'a[href="static"]', '/static');
    await page.waitForTimeout(1600);
    expect(await page.locator('#streamed-counter').count()).toBe(0);
    expect(streamingId).toBeDefined();
  });
});
