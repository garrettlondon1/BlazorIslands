import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { islandFetch, islandJson, IslandHttpError, readConfig } from '../src/http';

let requests: Request[];

beforeEach(() => {
  requests = [];
  document.head.innerHTML = `<base href="/app/"><meta name="blazor-islands" content='{"afHeader":"RequestVerificationToken","afToken":"tok-1","requestHeader":"X-Blazor-Island"}'>`;
  vi.stubGlobal('fetch', vi.fn(async (req: Request) => {
    requests.push(req);
    if (req.url.endsWith('/fail')) {
      return new Response(JSON.stringify({ title: 'nope' }), { status: 400, headers: { 'content-type': 'application/problem+json' } });
    }
    return new Response(req.method === 'GET' ? '[1,2]' : await req.text(), { status: 200 });
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = '';
});

describe('islandFetch', () => {
  it('resolves relative URLs against <base href> and marks the request as an island call', async () => {
    await islandFetch('api/items');
    const [req] = requests;
    expect(new URL(req!.url).pathname).toBe('/app/api/items');
    expect(req!.headers.get('X-Blazor-Island')).toBe('1');
    expect(req!.credentials).toBe('same-origin');
    expect(req!.headers.has('RequestVerificationToken')).toBe(false);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('sends the antiforgery token on %s', async (method) => {
    await islandFetch('api/items', { method, body: '{}' });
    expect(requests[0]!.headers.get('RequestVerificationToken')).toBe('tok-1');
  });

  it('reads the token fresh, so a token swapped in by enhanced navigation is used', async () => {
    document.querySelector('meta[name="blazor-islands"]')!.setAttribute('content', '{"afHeader":"RequestVerificationToken","afToken":"tok-2"}');
    await islandFetch('api/items', { method: 'POST' });
    expect(requests[0]!.headers.get('RequestVerificationToken')).toBe('tok-2');
  });

  it('does not overwrite an explicit header', async () => {
    await islandFetch('api/items', { method: 'POST', headers: { RequestVerificationToken: 'mine' } });
    expect(requests[0]!.headers.get('RequestVerificationToken')).toBe('mine');
  });
});

describe('islandJson', () => {
  it('serializes the body and parses the response', async () => {
    const echoed = await islandJson<{ a: number }>('api/echo', { method: 'POST', body: { a: 1 } });
    expect(echoed).toEqual({ a: 1 });
    expect(requests[0]!.headers.get('content-type')).toBe('application/json');
    expect(await islandJson<number[]>('api/list')).toEqual([1, 2]);
  });

  it('throws IslandHttpError with the parsed ProblemDetails', async () => {
    const error = (await islandJson('api/fail').catch((e: unknown) => e)) as IslandHttpError;
    expect(error).toBeInstanceOf(IslandHttpError);
    expect(error.response.status).toBe(400);
    expect(error.body).toEqual({ title: 'nope' });
  });
});

describe('readConfig', () => {
  it('tolerates a missing or malformed meta', () => {
    document.head.innerHTML = '';
    expect(readConfig()).toEqual({});
    document.head.innerHTML = `<meta name="blazor-islands" content="{oops">`;
    expect(readConfig()).toEqual({});
  });
});

