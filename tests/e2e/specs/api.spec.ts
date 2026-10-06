import { test, expect, waitForIsland } from '../fixtures';

test.describe('Web API with cookie auth', () => {
  test('signed out: the island gets a 401, not a login-page redirect', async ({ page }) => {
    await page.goto('/api-demo');
    await waitForIsland(page, 'notes');
    await expect(page.locator('#notes [data-testid=notes-status]')).toHaveText(/answered 401/);
  });

  test('signed in: GET and antiforgery-protected POST work with the cookie', async ({ page }) => {
    await page.goto('/api-demo');
    await page.fill('#user-name', `user-${Date.now()}`);
    await page.click('#login');
    await expect(page.locator('#signed-in')).toBeVisible();
    await waitForIsland(page, 'notes');
    await expect(page.locator('#notes [data-testid=notes-status]')).toHaveText('0 note(s)');

    await page.locator('#notes [data-testid=note-input]').fill('Ship islands');
    await page.locator('#notes [data-testid=note-add]').click();
    await expect(page.locator('#notes [data-testid=notes] li')).toHaveText([/Ship islands \(Info, by user-/]);
    await expect(page.locator('#notes [data-testid=notes-status]')).toHaveText('1 note(s)');

    // Sign out (enhanced form post), the island re-mounts under the new identity and the meta token is refreshed.
    await page.click('#logout');
    await expect(page.locator('#login')).toBeVisible();
    await expect(page.locator('#notes [data-testid=notes-status]')).toHaveText(/answered 401/);
  });

  test('a POST without the antiforgery token is rejected', async ({ page }) => {
    await page.goto('/api-demo');
    await page.fill('#user-name', `csrf-${Date.now()}`);
    await page.click('#login');
    await expect(page.locator('#signed-in')).toBeVisible();

    const status = await page.evaluate(async () => {
      const response = await fetch('api/notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Blazor-Island': '1' },
        body: JSON.stringify({ text: 'forged', kind: 'Info' }),
      });
      return response.status;
    });
    expect(status).toBe(400);
  });

  test('island requests get 401 where browser navigations get the login redirect', async ({ request }) => {
    // A Razor page behind [Authorize]: a normal navigation is redirected to the login page...
    const page = await request.get('/account/secure', { maxRedirects: 0 });
    expect(page.status()).toBe(302);
    expect(page.headers()['location']).toContain('/account/login');

    // ...while the same request from an island gets a bare 401 it can handle.
    const fromIsland = await request.get('/account/secure', { maxRedirects: 0, headers: { 'X-Blazor-Island': '1' } });
    expect(fromIsland.status()).toBe(401);

    // And the API answers islands with 401 and no HTML status page body.
    const api = await request.get('/api/notes', { maxRedirects: 0, headers: { 'X-Blazor-Island': '1' } });
    expect(api.status()).toBe(401);
    expect(await api.text()).toBe('');
  });
});
