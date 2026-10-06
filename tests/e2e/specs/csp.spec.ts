import { test, expect, waitForIsland } from '../fixtures';

const isStrictDynamic = (name: string) => name.includes('strict-dynamic');

test.describe('Content-Security-Policy', () => {
  test('every page is served with a strict nonce-based policy', async ({ request }, info) => {
    const response = await request.get('/static');
    const csp = response.headers()['content-security-policy'];
    expect(csp).toBeTruthy();
    if (isStrictDynamic(info.project.name)) {
      expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9_-]{16,}' 'strict-dynamic'( 'wasm-unsafe-eval')?(;|$)/);
    } else {
      // 'wasm-unsafe-eval' (WebAssembly compilation only) because the sample runs Interactive WebAssembly pages.
      expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9_-]{16,}'( 'wasm-unsafe-eval')?(;|$)/);
    }
    expect(csp).not.toContain("'unsafe-inline'");
    // 'wasm-unsafe-eval' (WebAssembly compilation only) is allowed; JavaScript eval is not.
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("style-src 'self'");

    const html = await response.text();
    const nonce = /'nonce-([^']+)'/.exec(csp)![1];
    // Every server-rendered script and preload carries this request's nonce.
    const tags = [...html.matchAll(/<(script|link rel="modulepreload")[^>]*>/g)].map((m) => m[0]);
    expect(tags.length).toBeGreaterThanOrEqual(4);
    for (const tag of tags) {
      expect(tag, tag).toContain(`nonce="${nonce}"`);
    }
  });

  test('nonces are unique per request', async ({ request }) => {
    const a = (await request.get('/static')).headers()['content-security-policy'];
    const b = (await request.get('/static')).headers()['content-security-policy'];
    expect(a).not.toBe(b);
  });

  test('the policy is enforced: injected inline script is blocked (trusted-script creation follows strict-dynamic)', async ({ page, diagnostics }, info) => {
    diagnostics.allowCspViolations = true;
    await page.goto('/static');
    await waitForIsland(page, 'static-counter');
    const result = await page.evaluate(async () => {
      const w = window as any;
      w.__inlineAttr = false;
      w.__created = false;
      // An inline event handler is blocked under both policies.
      const button = document.createElement('button');
      button.setAttribute('onclick', 'window.__inlineAttr = true');
      document.body.append(button);
      button.click();
      button.remove();
      // A script element created at runtime: blocked by Strict(), allowed by StrictDynamic() (trust propagates).
      const s = document.createElement('script');
      s.textContent = 'window.__created = true';
      document.body.append(s);
      s.remove();
      await new Promise((r) => setTimeout(r, 100));
      return { inlineAttr: w.__inlineAttr, created: w.__created };
    });
    expect(result.inlineAttr).toBe(false);
    expect(result.created).toBe(isStrictDynamic(info.project.name));
    const violations = await page.evaluate(() => (window as any).__csp as string[]);
    expect(violations.some((v) => v.startsWith('script-src'))).toBe(true);
  });

  test('a full tour of every demo page produces zero violations', async ({ page }) => {
    await page.goto('/');
    for (const href of ['static', 'props?n=1', 'streaming', 'interactive', 'preact-tsx', 'react', 'react-app', 'api-demo', 'shadow-none', 'errors', '']) {
      await page.click(`nav a[href="${href}"]`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(250);
    }
    // The fixture asserts zero violations after the test.
  });
});
