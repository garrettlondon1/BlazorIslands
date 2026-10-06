import { test, expect, waitForIsland, markDocument, sameDocument, enhancedNavigate, lifecycle } from '../fixtures';

test.describe('framework bundles', () => {
  test('Preact TSX: components from a bundle mount by name and keep local state', async ({ page }) => {
    await page.goto('/preact-tsx');
    await waitForIsland(page, 'todo');
    const todo = page.locator('#todo');
    await expect(todo.locator('[data-testid=todo-title]')).toHaveText('Groceries');
    await expect(todo.locator('[data-testid=todo-items] li')).toHaveText(['Milk', 'Bread']);
    await todo.locator('[data-testid=todo-input]').fill('Eggs');
    await todo.locator('[data-testid=todo-add]').click();
    await expect(todo.locator('[data-testid=todo-items] li')).toHaveText(['Milk', 'Bread', 'Eggs']);
  });

  test('Preact TSX and htm islands share one Preact, so signals are shared across islands', async ({ page }) => {
    await page.goto('/preact-tsx');
    await waitForIsland(page, 'signal-a');
    await waitForIsland(page, 'signal-b');
    await page.locator('#signal-a [data-testid=signal]').click();
    await page.locator('#signal-b [data-testid=signal]').click();
    await page.locator('#signal-a [data-testid=signal]').click();
    await expect(page.locator('#signal-a [data-testid=signal]')).toHaveText('A: 3');
    await expect(page.locator('#signal-b [data-testid=signal]')).toHaveText('B: 3');

    // Exactly one copy of Preact was loaded, through the import map.
    const preactLoads = await page.evaluate(() =>
      performance.getEntriesByType('resource').filter((r) => /vendor\/preact\.[^/]*mjs/.test(r.name)).length);
    expect(preactLoads).toBe(1);
  });

  test('React TSX: one root per island, F# record props rendered', async ({ page }) => {
    await page.goto('/react');
    await waitForIsland(page, 'greeting');
    await waitForIsland(page, 'chart');
    await expect(page.locator('#greeting [data-testid=greeting]')).toHaveText('Hello Ada, visit #3');
    await page.locator('#greeting [data-testid=greeting-click]').click();
    await expect(page.locator('#greeting [data-testid=greeting-click]')).toHaveText('Clicked 1 times');

    await expect(page.locator('#chart [data-testid=chart-title]')).toHaveText('Islands per page');
    const bars = page.locator('#chart [data-testid=bar]');
    await expect(bars).toHaveCount(3);
    // F# `Highlight: string option` = Some "Static" arrives as "Static" and is highlighted.
    await expect(page.locator('#chart [data-testid=bar][data-label=Static]')).toHaveAttribute('fill', '#cf222e');
    await expect(page.locator('#chart [data-testid=bar][data-label=Home]')).toHaveAttribute('fill', '#0969da');
  });

  test('a page-specific bundle in <HeadContent> loads on enhanced navigation', async ({ page }) => {
    await page.goto('/');
    await markDocument(page);
    await enhancedNavigate(page, 'a[href="react"]', '/react');
    await waitForIsland(page, 'greeting');
    expect(await sameDocument(page)).toBe(true);
  });

  test('React app: one root, islands share context, and app state survives enhanced navigation', async ({ page }) => {
    await page.goto('/react-app');
    await waitForIsland(page, 'cart-button');
    await waitForIsland(page, 'cart-summary');
    await markDocument(page);

    await page.locator('#cart-button [data-testid=add-to-cart]').click();
    await page.locator('#cart-button [data-testid=add-to-cart]').click();
    await expect(page.locator('#cart-summary [data-testid=cart-count]')).toHaveText('Cart: 2 item(s)');

    await enhancedNavigate(page, '#react-app-switch', '/react-app/details');
    await expect(page.locator('[data-testid=add-to-cart]')).toHaveText('Add Details product');
    await page.locator('[data-testid=add-to-cart]').click();
    await expect(page.locator('[data-testid=cart-count]')).toHaveText('Cart: 3 item(s)');

    // Leave React entirely: islands unmount, but the shared root (and the cart) stay alive for the next visit.
    await enhancedNavigate(page, 'a[href="static"]', '/static');
    await expect.poll(async () => (await lifecycle(page)).filter((e) => e.type === 'unmount' && e.component === 'CartSummary').length).toBeGreaterThan(0);
    await enhancedNavigate(page, 'a[href="react-app"]', '/react-app');
    await waitForIsland(page, 'cart-summary');
    await expect(page.locator('#cart-summary [data-testid=cart-count]')).toHaveText('Cart: 3 item(s)');
    expect(await sameDocument(page)).toBe(true);
  });

  test('every island in a bundle shares one download', async ({ page }) => {
    await page.goto('/react');
    await waitForIsland(page, 'chart');
    const loads = await page.evaluate(() =>
      performance.getEntriesByType('resource').filter((r) => /islands\/react-bundle\.[^/]*js$/.test(r.name)).length);
    expect(loads).toBe(1);
  });
});
