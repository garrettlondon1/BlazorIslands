// Licensed under the MIT license.

interface IslandsConfig {
  afHeader?: string | null;
  afToken?: string | null;
  requestHeader?: string;
}

/** Reads `<meta name="blazor-islands">` fresh on every call: enhanced navigation replaces it after sign-in/sign-out. */
export function readConfig(doc: Document = document): IslandsConfig {
  const content = doc.querySelector('meta[name="blazor-islands"]')?.getAttribute('content');
  if (!content) {
    return {};
  }
  try {
    return JSON.parse(content) as IslandsConfig;
  } catch {
    return {};
  }
}

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * `fetch` for calling the app's own Web APIs from an island with cookie authentication:
 * - same-origin credentials,
 * - the `X-Blazor-Island` header, so cookie auth answers 401/403 instead of redirecting to a login page,
 * - the antiforgery token from `<IslandsHead />` on unsafe methods, validated by `.WithIslandAntiforgery()`,
 * - relative URLs resolved against the app base (`<base href>`), so sub-path hosting works.
 * Pass `ctx.signal` as `signal` to cancel in-flight calls when the island unmounts.
 */
export function islandFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const config = readConfig();
  const request = input instanceof Request ? input : new Request(new URL(input, document.baseURI), init);
  const headers = new Headers(input instanceof Request ? request.headers : init.headers);
  headers.set(config.requestHeader ?? 'X-Blazor-Island', '1');
  if (unsafeMethods.has(request.method.toUpperCase()) && config.afHeader && config.afToken && !headers.has(config.afHeader)) {
    headers.set(config.afHeader, config.afToken);
  }
  return fetch(new Request(request, { headers, credentials: init.credentials ?? 'same-origin' }));
}

export class IslandHttpError extends Error {
  constructor(readonly response: Response, readonly body: unknown) {
    super(`${response.status} ${response.statusText} from ${response.url}`);
    this.name = 'IslandHttpError';
  }
}

/** `islandFetch` plus JSON in and out. Throws `IslandHttpError` (with the parsed ProblemDetails body) on non-2xx. */
export async function islandJson<T>(input: string | URL, init: Omit<RequestInit, 'body'> & { body?: unknown } = {}): Promise<T> {
  const { body, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('accept', 'application/json');
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
    payload = JSON.stringify(body);
  }
  const response = await islandFetch(input, { ...rest, headers, body: payload });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new IslandHttpError(response, parsed);
  }
  return parsed as T;
}
