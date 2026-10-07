import type { Page } from '@playwright/test';
import { test, expect, waitForIsland, lifecycle, markDocument, sameDocument, enhancedNavigate } from '../fixtures';

/**
 * The same card island in Vue, Svelte, Solid (F#, Oxpecker.Solid) and React (F#, Feliz). Every framework must:
 * mount from its bundle; apply its compiled stylesheet inside the shadow root; take new props in place, keeping local
 * state; deliver events to OnEvent under Interactive Server; and run its own teardown when the user leaves.
 */
const frameworks = [
  { name: 'vue', border: 'rgb(66, 184, 131)' },
  { name: 'svelte', border: 'rgb(255, 62, 0)' },
  { name: 'solid', border: 'rgb(55, 139, 186)' },
  { name: 'feliz', border: 'rgb(55, 139, 186)' },
];

// The framework's own lifecycle counter name, as each card records it.
const counterName = (name: string) => (name === 'solid' ? 'fsharp-solid' : name);

const card = (page: Page, id: string) => page.locator(`#${id}`);

async function cards(page: Page, name: string) {
  return page.evaluate((n) => ((window as any).__cards ?? {})[n] ?? { mounts: 0, unmounts: 0 }, name);
}

for (const fw of frameworks) {
  test.describe(fw.name, () => {
    test('mounts from its bundle with props from the server and its own scoped stylesheet', async ({ page }) => {
      await page.goto(`/frameworks/${fw.name}?n=1`);
      await waitForIsland(page, 'static-card');
      const c = card(page, 'static-card');
      await expect(c.getByTestId('title')).toHaveText('Static card, n=1');
      await expect(c.getByTestId('framework')).toHaveText(fw.name);
      await expect(c.getByTestId('count')).toHaveText('5');
      await expect(c.locator('[data-testid=items] li')).toHaveText(['alpha', 'beta', 'n=1']);

      // Styled by its stylesheet, linked inside the shadow root: fingerprinted, and nothing leaks to the page.
      await expect(c.locator('.card')).toHaveCSS('border-left-color', fw.border);
      const link = await page.evaluate(() =>
        document.getElementById('static-card')!.shadowRoot!.querySelector('link[rel=stylesheet]')?.getAttribute('href'));
      expect(link).toMatch(/\.[a-z0-9]{10}\.css$|\/[a-z-]+\.css$/);
      // One link per island, inside its shadow root; none in the page itself (querySelectorAll doesn't pierce shadow roots).
      expect(await page.evaluate(() => document.querySelectorAll('link[rel=stylesheet][href*="islands/"]').length)).toBe(0);
    });

    test('new props over enhanced navigation update in place and keep local state', async ({ page }) => {
      await page.goto(`/frameworks/${fw.name}?n=1`);
      await waitForIsland(page, 'static-card');
      await markDocument(page);
      const id = await page.evaluate(() => (document.getElementById('static-card') as any).islandId);
      const c = card(page, 'static-card');
      await c.getByTestId('increment').click();
      await c.getByTestId('increment').click();
      await expect(c.getByTestId('count')).toHaveText('7');

      await enhancedNavigate(page, '#fw-next', 'n=2');
      await expect(c.getByTestId('title')).toHaveText('Static card, n=2');
      await expect(c.locator('[data-testid=items] li')).toHaveText(['alpha', 'beta', 'n=2']);
      await expect(c.getByTestId('count')).toHaveText('7');
      expect(await page.evaluate(() => (document.getElementById('static-card') as any).islandId)).toBe(id);
      expect(await sameDocument(page)).toBe(true);
      expect((await lifecycle(page)).filter((e) => e.type === 'update' && e.id === id).length).toBeGreaterThan(0);
    });

    test('under Interactive Server: .NET pushes props, and island events reach OnEvent', async ({ page }) => {
      await page.goto(`/frameworks/${fw.name}`);
      await page.locator('#interactive-section[data-interactive=true]').waitFor();
      await waitForIsland(page, 'interactive-card');
      const c = card(page, 'interactive-card');
      await c.getByTestId('increment').click();
      await expect(c.getByTestId('count')).toHaveText('11');

      await page.click('#fw-server-increment');
      await expect(c.getByTestId('title')).toHaveText('Interactive card, server start 11');
      await expect(c.locator('[data-testid=items] li')).toHaveText(['server', 'start 11']);
      await expect(c.getByTestId('count')).toHaveText('11');

      await c.getByTestId('emit').click();
      await expect(page.locator('#fw-events')).toHaveText(`Events: 1 (last: card-click:${counterName(fw.name)}:11)`);
    });

    test('leaving the page runs the framework\'s own teardown for every card', async ({ page }) => {
      await page.goto(`/frameworks/${fw.name}`);
      await page.locator('#interactive-section[data-interactive=true]').waitFor();
      await waitForIsland(page, 'static-card');
      await waitForIsland(page, 'interactive-card');
      await expect.poll(async () => (await cards(page, counterName(fw.name))).mounts).toBe(2);

      await enhancedNavigate(page, '#fw-to-static', '/static');
      await waitForIsland(page, 'static-counter');
      await expect.poll(async () => cards(page, counterName(fw.name))).toEqual({ mounts: 2, unmounts: 2 });
      const report = await page.evaluate(() => (window as any).BlazorIslands.inspect());
      expect(report.problems).toEqual([]);
      expect(report.instances.filter((i: any) => i.component === 'Card')).toEqual([]);
    });
  });
}

test('switching between frameworks keeps one document and leaves no instance behind', async ({ page }) => {
  await page.goto('/frameworks/vue');
  await waitForIsland(page, 'static-card');
  await markDocument(page);
  for (const next of ['svelte', 'solid', 'feliz', 'vue']) {
    await enhancedNavigate(page, `#fw-to-${next}`, `/frameworks/${next}`);
    await waitForIsland(page, 'static-card');
    await expect(card(page, 'static-card').getByTestId('framework')).toHaveText(next);
  }
  expect(await sameDocument(page)).toBe(true);
  const report = await page.evaluate(() => (window as any).BlazorIslands.inspect());
  expect(report.problems).toEqual([]);
  // Only the current page's cards are live.
  expect(report.instances.filter((i: any) => i.component === 'Card').length).toBeLessThanOrEqual(2);
});
