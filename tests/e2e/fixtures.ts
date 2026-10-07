import { test as base, expect, type Page } from '@playwright/test';

export interface LifecycleRecord {
  type: 'mount' | 'update' | 'unmount' | 'error' | 'page-update';
  src: string;
  component: string | null;
  id: number;
  error?: string;
}

interface Diagnostics {
  /** CSP violations are failures unless a test opts in. */
  allowCspViolations: boolean;
  /** Uncaught page errors (not console.error). */
  pageErrors: string[];
}

/**
 * Every test records CSP violations, uncaught errors and island lifecycle events from the first byte of the document.
 * Enhanced navigation keeps the same document, so the records span the whole test.
 *
 * Projects with `metadata.pathBase` (sub-path hosting, e.g. "/coolapp") run the same specs: root-relative URLs passed to
 * `page.goto` and the `request` fixture are rewritten under the path base, so a spec written for "/static" exercises
 * "/coolapp/static". Anything the app itself requests outside the base is a 404 from the server.
 */
export const test = base.extend<{ diagnostics: Diagnostics }>({
  page: async ({ page }, use, info) => {
    const pathBase = info.project.metadata?.pathBase as string | undefined;
    if (pathBase) {
      const goto = page.goto.bind(page);
      page.goto = (url, options) => goto(url.startsWith('/') ? pathBase + url : url, options);
    }
    await use(page);
  },
  request: async ({ request }, use, info) => {
    const pathBase = info.project.metadata?.pathBase as string | undefined;
    if (!pathBase) {
      await use(request);
      return;
    }
    const rewrite = (url: unknown) => (typeof url === 'string' && url.startsWith('/') ? pathBase + url : url);
    await use(new Proxy(request, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof value === 'function' && ['get', 'post', 'put', 'patch', 'delete', 'head', 'fetch'].includes(String(prop))) {
          return (url: unknown, ...rest: unknown[]) => value.call(target, rewrite(url), ...rest);
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }));
  },
  diagnostics: [
    async ({ page }, use, info) => {
      const diagnostics: Diagnostics = { allowCspViolations: false, pageErrors: [] };
      // Under a path base, every request the browser makes to the app's origin must stay inside it.
      const pathBase = info.project.metadata?.pathBase as string | undefined;
      const escaped: string[] = [];
      if (pathBase) {
        const origin = new URL(info.project.use.baseURL!).origin;
        page.on('request', (r) => {
          const url = new URL(r.url());
          if (url.origin === origin && url.pathname !== pathBase && !url.pathname.startsWith(pathBase + '/')) {
            escaped.push(`${r.method()} ${url.pathname}${url.search} (${r.resourceType()})`);
          }
        });
      }
      await page.addInitScript(() => {
        const w = window as unknown as { __csp: string[]; __life: unknown[]; __pageUpdates: number };
        w.__csp = [];
        w.__life = [];
        w.__pageUpdates = 0;
        // Bridged from Blazor's 'enhancedload' by the BlazorIslands JS initializer.
        document.addEventListener('blazor-islands:page-update', () => { w.__pageUpdates++; });
        document.addEventListener('securitypolicyviolation', (e) => {
          w.__csp.push(`${e.effectiveDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`);
        });
        document.addEventListener('blazor-islands:lifecycle', (e) => {
          const d = (e as CustomEvent).detail;
          w.__life.push({ ...d, error: d.error ? String(d.error) : undefined });
        });
      });
      page.on('pageerror', (e) => diagnostics.pageErrors.push(String(e)));
      page.on('console', (m) => {
        // WebKit reports some uncaught rejections only on the console.
        if (m.type() === 'error' && /^Unhandled Promise Rejection: /.test(m.text())) {
          diagnostics.pageErrors.push(m.text());
        } else if (m.type() === 'error' && /Fetch API cannot load .*\/_framework\//.test(m.text())) {
          diagnostics.pageErrors.push(m.text());
        }
      });
      await use(diagnostics);
      if (!diagnostics.allowCspViolations && !page.isClosed()) {
        const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []).catch(() => []);
        expect(violations, 'Content-Security-Policy violations').toEqual([]);
      }
      expect(withoutFrameworkLoaderNoise(diagnostics.pageErrors), 'uncaught page errors').toEqual([]);
      expect(escaped, `requests outside the path base ${pathBase}`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/**
 * Leaving a page (reload, form post, navigation) while Blazor is still downloading its own framework files makes Firefox
 * and WebKit report the aborted fetches and imports as uncaught errors. That is the framework's loader, not island code.
 * Generic "load failed" messages are only dropped when a _framework abort was reported in the same test.
 */
export function withoutFrameworkLoaderNoise(errors: string[]): string[] {
  const frameworkAbort = /\/_framework\/.*(NetworkError|dynamically imported module|failed 0|access control checks)|(NetworkError|access control checks|dynamically imported module).*\/_framework\//;
  if (!errors.some((e) => frameworkAbort.test(e))) {
    return errors;
  }
  const generic = /^(Unhandled Promise Rejection: )?TypeError: (Load failed|NetworkError when attempting to fetch resource\.?)$/;
  return errors.filter((e) => !frameworkAbort.test(e) && !generic.test(e));
}

/** Waits until the island with this element id reports the given state. */
export async function waitForIsland(page: Page, id: string, state: 'mounted' | 'error' | 'loading' | 'idle' = 'mounted', timeout = 15_000) {
  await page.waitForFunction(
    ([elementId, expected]) => {
      const el = document.getElementById(elementId) as (HTMLElement & { islandState?: string }) | null;
      return !!el && el.islandState === expected;
    },
    [id, state] as const,
    { timeout },
  );
}

export function islandId(page: Page, id: string) {
  return page.evaluate((elementId) => (document.getElementById(elementId) as unknown as { islandId?: number })?.islandId, id);
}

export function lifecycle(page: Page): Promise<LifecycleRecord[]> {
  return page.evaluate(() => (window as unknown as { __life: LifecycleRecord[] }).__life);
}

/** Text rendered inside an island's shadow root (or light DOM for shadow="none"). */
export function islandText(page: Page, id: string) {
  return page.evaluate((elementId) => {
    const el = document.getElementById(elementId);
    return (el?.shadowRoot ?? el)?.textContent?.trim() ?? null;
  }, id);
}

/** Marks the current document; `sameDocument` proves later navigations were enhanced rather than full loads. */
export async function markDocument(page: Page) {
  await page.evaluate(() => { (window as unknown as { __doc: string }).__doc = 'original'; });
}

export function sameDocument(page: Page) {
  return page.evaluate(() => (window as unknown as { __doc?: string }).__doc === 'original');
}

/**
 * Clicks a link and waits until Blazor has patched the new page into the document. Blazor pushes the URL before it
 * fetches the page, so waiting for the URL alone races the DOM merge; this waits for Blazor's own 'enhancedload'.
 */
export async function enhancedNavigate(page: Page, selector: string, urlPart: string | RegExp) {
  const before = await page.evaluate(() => (window as unknown as { __pageUpdates: number }).__pageUpdates);
  await page.click(selector);
  await page.waitForURL(typeof urlPart === 'string' ? new RegExp(urlPart.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : urlPart);
  await page.waitForFunction((b) => (window as unknown as { __pageUpdates: number }).__pageUpdates > b, before);
}

export async function echo(page: Page, id: string): Promise<{ id: number; n: number | null; source: string | null; updates: number }> {
  const text = await page.evaluate((elementId) => document.getElementById(elementId)?.shadowRoot?.querySelector('[data-testid=echo]')?.textContent ?? 'null', id);
  return JSON.parse(text);
}
