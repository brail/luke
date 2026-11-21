/**
 * `authorizeLogin`: what each answer of `auth.login` becomes on the way to the login page.
 *
 * Auth.js gives the page one result for every refused login, so some answers have to leave this
 * function by other routes, and each has a way of getting lost. The answers given once the password
 * is proven — pending approval, email unverified, maintenance, unavailable, a directory mail
 * another account holds — travel as the `code`
 * of a thrown `CredentialsSignin` subclass, past the `catch` of `authorizeLogin` that turns every
 * other error into a plain refusal; an API that cannot be reached is the service being unavailable. "Throttled" travels as a mark in `loginThrottleContext`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SIGN_IN_REFUSED_MESSAGE } from '@luke/core';

import {
  authorizeLogin,
  LoginEmailInUse,
  LoginEmailUnverified,
  LoginMaintenance,
  LoginPending,
  LoginServiceUnavailable,
  LoginUnavailable,
} from '../loginAuthorize';
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

/** The body `server.ts` gives the global Fastify limiter's 429 (`errorResponseBuilder`). */
const GLOBAL_LIMITER_429 = { statusCode: 429, error: 'Rate limit exceeded', message: 'Too many requests from 203.0.113.7', retryAfter: 60 };

const trpcError = (code: string, message: string, data: object = {}) => ({
  error: { message, data: { code, ...data } },
});

beforeEach(() => {
  vi.stubEnv('INTERNAL_API_URL', 'http://api.test:3001');
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

  it('a login the directory could not complete after proof leaves as an error Auth.js carries to the page', async () => {
    // Production replaces the message of every 5xx: only the code can be relied on.
    apiAnswers(503, trpcError('SERVICE_UNAVAILABLE', 'Internal server error', { unavailableReason: 'auth_unavailable' }));

    const error = await authorizeLogin(credentials, request).catch(e => e);

    expect(error).toBeInstanceOf(LoginUnavailable);
    // What Auth.js puts in the sign-in URL, and `signIn()` hands to the page.
    expect(error.code).toBe('unavailable');
  });

  it.each([
    ['a 503 without a reason', () => Response.json(trpcError('SERVICE_UNAVAILABLE', 'Internal server error'), { status: 503 })],
    ['a 503 with a reason Luke does not send', () => Response.json(trpcError('SERVICE_UNAVAILABLE', 'x', { unavailableReason: 'x' }), { status: 503 })],
    // Never the post-proof maintenance code: a 503 is answered before any proof.
    ['a 503 for maintenance', () => Response.json(trpcError('SERVICE_UNAVAILABLE', 'x', { unavailableReason: 'maintenance' }), { status: 503 })],
    ["a proxy's HTML 503", () => new Response('<html>503</html>', { status: 503, headers: { 'content-type': 'text/html' } })],
    ["a proxy's 502 that is not JSON", () => new Response('Bad Gateway', { status: 502 })],
    ['a gateway timeout', () => new Response('', { status: 504 })],
    ['an API that cannot be reached', () => Promise.reject(new TypeError('fetch failed'))],
  ])('%s is the service being unavailable, not a refusal', async (_name, answer) => {
    vi.stubGlobal('fetch', vi.fn(async () => answer()));

    const error = await authorizeLogin(credentials, request).catch(e => e);

    expect(error).toBeInstanceOf(LoginServiceUnavailable);
    expect(error.code).toBe('service_unavailable');
  });

  // The API answers pending approval only after the password is proven: the page may show the
  // pending notice, and keep the password for `auth.submitPendingEmail`, on this code alone.
  it.each([
    ['ACCOUNT_PENDING_APPROVAL', 'pending'],
    ['ACCOUNT_PENDING_APPROVAL:NEEDS_EMAIL', 'pending_email'],
  ])('an account pending approval (%s) leaves as code %s', async (message, code) => {
    apiAnswers(403, trpcError('FORBIDDEN', message));

    const error = await authorizeLogin(credentials, request).catch(e => e);

    expect(error).toBeInstanceOf(LoginPending);
    expect(error.code).toBe(code);
  });

  it('an email still to verify, answered after the password is proven, leaves as code email_unverified', async () => {
    apiAnswers(403, trpcError('FORBIDDEN', 'EMAIL_NOT_VERIFIED'));

    const error = await authorizeLogin(credentials, request).catch(e => e);

    expect(error).toBeInstanceOf(LoginEmailUnverified);
    expect(error.code).toBe('email_unverified');
  });

  it('maintenance, answered after the password is proven, leaves as code maintenance', async () => {
    apiAnswers(403, trpcError('FORBIDDEN', 'MAINTENANCE_ACTIVE'));

    const error = await authorizeLogin(credentials, request).catch(e => e);

    expect(error).toBeInstanceOf(LoginMaintenance);
    expect(error.code).toBe('maintenance');
  });

  it('a directory mail another account holds, answered after the password is proven, leaves as code email_in_use', async () => {
    apiAnswers(403, trpcError('FORBIDDEN', 'LDAP_EMAIL_IN_USE'));

    const error = await authorizeLogin(credentials, request).catch(e => e);

    expect(error).toBeInstanceOf(LoginEmailInUse);
    expect(error.code).toBe('email_in_use');
  });

  it.each([
    ['a refusal before proof', 401, trpcError('UNAUTHORIZED', SIGN_IN_REFUSED_MESSAGE)],
    ['a maintenance answer on anything but a 403', 401, trpcError('FORBIDDEN', 'MAINTENANCE_ACTIVE')],
    // The global limiter's own 429 body carries no tRPC code.
    ['the global limiter', 429, GLOBAL_LIMITER_429],
    ['an unverified answer on anything but a 403', 401, trpcError('FORBIDDEN', 'EMAIL_NOT_VERIFIED')],
    ['a 403 whose message only starts like an unverified one', 403, trpcError('FORBIDDEN', 'EMAIL_NOT_VERIFIED_X')],
    ['a pending answer on anything but a 403', 401, trpcError('FORBIDDEN', 'ACCOUNT_PENDING_APPROVAL')],
    ['a 403 whose message only starts like a pending one', 403, trpcError('FORBIDDEN', 'ACCOUNT_PENDING_APPROVAL_X')],
    ['an email-in-use answer on anything but a 403', 401, trpcError('FORBIDDEN', 'LDAP_EMAIL_IN_USE')],
    ['a 403 whose message only starts like an email-in-use one', 403, trpcError('FORBIDDEN', 'LDAP_EMAIL_IN_USE_X')],
  ])('%s is a plain refusal', async (_name, status, body) => {
    apiAnswers(status, body);

    expect(await authorizeLogin(credentials, request)).toBeNull();
  });

  it('the global limiter marks nothing for the route wrapper', async () => {
    apiAnswers(429, GLOBAL_LIMITER_429);
    const state: LoginThrottleState = {};

    await loginThrottleContext.run(state, () => authorizeLogin(credentials, request));

    expect(state).toEqual({});
  });

  it('a throttled login is a plain refusal that marks the request for the route wrapper', async () => {
    apiAnswers(429, trpcError('TOO_MANY_REQUESTS', 'Troppe richieste. Riprova più tardi.', { retryAfterSeconds: 42 }));
    const state: LoginThrottleState = {};

    const result = await loginThrottleContext.run(state, () => authorizeLogin(credentials, request));

    expect(result).toBeNull();
    expect(state).toEqual({ retryAfterSeconds: 42 });
  });
});
