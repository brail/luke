/**
 * The one sign-out path (#238, ADR-048): a request whose provenance cannot be verified changes
 * nothing; any other ends the API sessions within a deadline when it can, then always clears this
 * browser's session, and tells the user when the server-side end did not go through.
 */

import { TRPCClientError } from '@trpc/client';
import { encode } from 'next-auth/jwt';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  clientArgs: [] as unknown[][],
  signOut: vi.fn(),
  auth: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock('server-only', () => ({}));
// The configuration's shape: the path must read the session under the app's own cookie name, salt
// and secret, which differ from Auth.js's defaults, so a bare `getToken` call finds no session.
vi.mock('../../auth', () => ({
  config: {
    secret: 'test-secret-for-server-logout',
    cookies: { sessionToken: { name: 'next-auth.session-token' } },
  },
  signOut: h.signOut,
  auth: h.auth,
}));
vi.mock('next-auth/jwt', async importOriginal => {
  const actual = await importOriginal<typeof import('next-auth/jwt')>();
  h.getToken.mockImplementation(actual.getToken);
  return { ...actual, getToken: h.getToken };
});
vi.mock('../trpcAuth', () => ({
  createAuthedTrpcClient: (...args: unknown[]) => {
    h.clientArgs.push(args);
    return { auth: { logout: { mutate: h.mutate } } };
  },
}));

const { config } = await import('../../auth');
const { serverLogout } = await import('../serverLogout');

const COOKIE = config.cookies.sessionToken.name;
const ORIGIN = 'http://localhost:3000';

// `TRPCClientError` keeps the response shape it is given; the path reads only `data.code`.
const trpcError = (code: string) => TRPCClientError.from({ error: { code: -1, message: code, data: { code } } } as never);

async function sessionCookie(accessToken = 'api-token'): Promise<string> {
  const value = await encode({ token: { sub: 'u1', accessToken }, secret: config.secret, salt: COOKIE });
  return `${COOKIE}=${value}`;
}

function logoutRequest(headers: Record<string, string>, url = `${ORIGIN}/api/auth/logout`): Request {
  return new Request(url, { method: 'POST', headers });
}

async function sameOriginRequest(cookie?: string): Promise<Request> {
  return logoutRequest({ 'sec-fetch-site': 'same-origin', cookie: cookie ?? (await sessionCookie()) });
}

function expectRedirect(response: Response, location: string) {
  expect(response.status).toBe(303);
  expect(response.headers.get('location')).toBe(location);
}

beforeEach(() => {
  h.mutate.mockResolvedValue({ success: true });
  h.signOut.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  h.clientArgs.length = 0;
});

describe('serverLogout: revocation', () => {
  it('ends the API sessions with the bearer from the cookie, then the browser session', async () => {
    const request = await sameOriginRequest();

    expectRedirect(await serverLogout(request), '/login');
    expect(h.clientArgs).toEqual([['api-token', request.headers]]);
    expect(h.mutate).toHaveBeenCalledOnce();
    expect(h.signOut).toHaveBeenCalledWith({ redirect: false });
    // Reading the session must never run the `jwt` callback, whose refresh has no deadline.
    expect(h.auth).not.toHaveBeenCalled();
  });

  it('reads a session split into chunks', async () => {
    const [name, value] = (await sessionCookie('x'.repeat(6000))).split(/=(.*)/s);
    const half = Math.ceil(value.length / 2);
    const cookie = `${name}.0=${value.slice(0, half)}; ${name}.1=${value.slice(half)}`;

    expectRedirect(await serverLogout(await sameOriginRequest(cookie)), '/login');
    expect(h.clientArgs[0]?.[0]).toBe('x'.repeat(6000));
  });

  it('counts UNAUTHORIZED as done: the bearer is already revoked or expired', async () => {
    h.mutate.mockRejectedValue(trpcError('UNAUTHORIZED'));

    expectRedirect(await serverLogout(await sameOriginRequest()), '/login');
    expect(h.signOut).toHaveBeenCalledOnce();
  });

  it.each([
    ['maintenance', trpcError('SERVICE_UNAVAILABLE')],
    ['a request limit', trpcError('TOO_MANY_REQUESTS')],
    ['a server error', trpcError('INTERNAL_SERVER_ERROR')],
    ['a network error', new TypeError('fetch failed')],
  ])('still clears the browser session on %s, and says so', async (_label, failure) => {
    h.mutate.mockRejectedValue(failure);

    expectRedirect(await serverLogout(await sameOriginRequest()), '/login?signout=incomplete');
    expect(h.signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it('gives up on an API that does not answer within 5 s', { timeout: 2_000 }, async () => {
    // An already-elapsed deadline; a call that ignores it would hang past the test's timeout.
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('', 'TimeoutError')));
    h.mutate.mockImplementation(
      (_input: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (opts?.signal?.aborted) reject(opts.signal.reason);
          opts?.signal?.addEventListener('abort', () => reject(opts.signal?.reason));
        })
    );

    expectRedirect(await serverLogout(await sameOriginRequest()), '/login?signout=incomplete');
    expect(timeout).toHaveBeenCalledWith(5_000);
    expect(h.signOut).toHaveBeenCalledOnce();
  });

  it('still clears the browser session when the session cannot be read', async () => {
    h.getToken.mockRejectedValueOnce(new Error('read failed'));

    expectRedirect(await serverLogout(await sameOriginRequest()), '/login?signout=incomplete');
    expect(h.mutate).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalledOnce();
  });

  it('with a cookie that does not decode, calls no API, clears the browser session and says so', async () => {
    expectRedirect(await serverLogout(await sameOriginRequest(`${COOKIE}=not-a-token`)), '/login?signout=incomplete');
    expect(h.mutate).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalledOnce();
  });

  it('with no session cookie, has nothing to end: no API call, no notice', async () => {
    expectRedirect(await serverLogout(await sameOriginRequest('other=1')), '/login');
    expect(h.mutate).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalledOnce();
  });
});

describe('serverLogout: provenance', () => {
  it.each([
    ['Sec-Fetch-Site same-origin', { 'sec-fetch-site': 'same-origin' }],
    ['no Fetch Metadata, matching Origin', { origin: ORIGIN }],
    ['no Fetch Metadata, no Origin, matching Referer', { referer: `${ORIGIN}/logout` }],
    ['same-site with a matching Origin', { 'sec-fetch-site': 'same-site', origin: ORIGIN }],
  ])('accepts %s', async (_label, headers: Record<string, string>) => {
    expectRedirect(await serverLogout(logoutRequest({ ...headers, cookie: await sessionCookie() })), '/login');
    expect(h.signOut).toHaveBeenCalledOnce();
  });

  it.each([
    ['cross-site with a foreign Origin', { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }],
    ['same-site with a foreign Origin', { 'sec-fetch-site': 'same-site', origin: 'http://other.localhost:3000' }],
    ['Origin: null', { origin: 'null' }],
    ['Origin: null with a matching Referer', { origin: 'null', referer: `${ORIGIN}/logout` }],
    ['a foreign Referer', { referer: 'https://evil.example/page' }],
    ['nothing verifiable', {}],
    ['Sec-Fetch-Site none', { 'sec-fetch-site': 'none' }],
  ])('refuses %s: reads nothing, changes nothing, asks for confirmation', async (_label, headers: Record<string, string>) => {
    expectRedirect(await serverLogout(logoutRequest({ ...headers, cookie: await sessionCookie() })), '/logout');
    expect(h.getToken).not.toHaveBeenCalled();
    expect(h.mutate).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it('compares against the public origin, not the address the server is reached on', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://luke.example');
    const behindProxy = 'http://0.0.0.0:3000/api/auth/logout';

    expectRedirect(
      await serverLogout(logoutRequest({ origin: 'https://luke.example', cookie: await sessionCookie() }, behindProxy)),
      '/login'
    );
    expectRedirect(await serverLogout(logoutRequest({ origin: 'http://0.0.0.0:3000' }, behindProxy)), '/logout');
  });
});
