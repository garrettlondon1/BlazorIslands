import { test, expect } from '../fixtures';

// Guards the cross-version project: proves it really runs against the locally built blazor.web.js.
test('the aspnetcore-main project serves blazor.web.js from the local clone', async ({ page }, info) => {
  test.skip(!info.project.name.includes('aspnetcore-main'), 'Only meaningful for the aspnetcore-main project.');
  const response = await page.goto('/static');
  const html = await response!.text();
  expect(html).toContain('src="/_dev/blazor.web.js"');
  const served = await page.request.get('/_dev/blazor.web.js');
  expect(served.status()).toBe(200);
  expect((await served.body()).length).toBeGreaterThan(100_000);
  await expect.poll(() => page.evaluate(() => typeof (window as any).Blazor?.navigateTo)).toBe('function');
});
