/**
 * `authorizeLogin`: what each answer of `auth.login` becomes on the way to the login page.
 *
 * Auth.js gives the page one result for every refused login, so two answers have to leave this
 * function by other routes, and each has a way of getting lost. "Unavailable" travels as the `code`
 * of a thrown `CredentialsSignin` subclass, past two `catch` blocks that turn every other error
 * into a plain refusal. "Throttled" travels as a mark in `loginThrottleContext`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authorizeLogin, LoginUnavailable } from '../loginAuthorize';
import { loginThrottleContext } from '../loginThrottleContext';

import type { LoginThrottleState } from '../loginThrottleContext';

// `next-auth`'s entry point pulls in `next/server`, which this Node-only tier cannot load. The one
// thing the module under test takes from it is the class to extend, and what matters here is that
// the error built on it survives both `catch` blocks with its `code`.
vi.mock('next-auth', () => ({
  CredentialsSignin: class CredentialsSignin extends Error {
    code = 'credentials';
  },
}));

const request = { headers: new Headers({ 'x-forwarded-for': '203.0.113.7' }) };
const credentials = { username: 'alice', password: 'her-password' };

/** The API's answer to `auth.login`, as tRPC shapes an error or a result. */
function apiAnswers(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

const trpcError = (code: string, message: string, data: object = {}) => ({
  error: { message, data: { code, ...data } },
});

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'http://api.test:3001');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('authorizeLogin', () => {
  it('returns the user of an accepted login', async () => {
    apiAnswers(200, {
      result: { data: { token: 'jwt', user: { id: 'u1', username: 'alice', email: 'a@test', role: 'viewer' } } },
    });

    expect(await authorizeLogin(credentials, request)).toMatchObject({
      id: 'u1',
      name: 'alice',
      role: 'viewer',
      accessToken: 'jwt',
    });
  });

  it('refuses without calling the API when a credential is missing', async () => {
    apiAnswers(200, {});

    expect(await authorizeLogin({ username: 'alice' }, request)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a login service that is unavailable leaves as an error Auth.js carries to the page', async () => {
    // Production replaces the message of every 5xx: only the code can be relied on.
    apiAnswers(503, trpcError('SERVICE_UNAVAILABLE', 'Internal server error'));

    const error = await authorizeLogin(credentials, request).catch(e => e);

    expect(error).toBeInstanceOf(LoginUnavailable);
    // What Auth.js puts in the sign-in URL, and `signIn()` hands to the page.
    expect(error.code).toBe('unavailable');
  });

  it.each([
    ['wrong credentials', 401, trpcError('UNAUTHORIZED', 'Credenziali non valide')],
    ['an account pending approval', 403, trpcError('FORBIDDEN', 'ACCOUNT_PENDING_APPROVAL:NEEDS_EMAIL')],
    ['an answer that is not JSON', 502, undefined],
  ])('%s is a plain refusal', async (_name, status, body) => {
    apiAnswers(status, body);

    expect(await authorizeLogin(credentials, request)).toBeNull();
  });

  it('an API that cannot be reached is a plain refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));

    expect(await authorizeLogin(credentials, request)).toBeNull();
  });

  it('a throttled login is a plain refusal that marks the request for the route wrapper', async () => {
    apiAnswers(429, trpcError('TOO_MANY_REQUESTS', 'Troppe richieste. Riprova più tardi.', { retryAfterSeconds: 42 }));
    const state: LoginThrottleState = {};

    const result = await loginThrottleContext.run(state, () => authorizeLogin(credentials, request));

    expect(result).toBeNull();
    expect(state).toEqual({ retryAfterSeconds: 42 });
  });
});
