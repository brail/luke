/**
 * Before the password is proven, `auth.login` tells a caller nothing about the account or the app's
 * state (#257): every failure — a wrong password, an unknown user, a directory that could not judge
 * the credentials, the `ldap-only` refusal of a correct non-admin password, a full per-account
 * bucket — is the same answer over HTTP, body and header names alike.
 *
 * What stays distinct is about the caller's own request: the per-IP bucket (its `retryAfterSeconds`
 * in the body), a malformed input, a malformed `Idempotency-Key`. After proof, a directory that
 * verified the password and could not write the user record is said to be unavailable.
 *
 * A password reset request, which proves nothing, answers the same success whatever fails behind
 * it, so it cannot tell an address with a local account from one without.
 *
 * The body is compared without `data.stack`, which only a non-production server sends.
 */

import { TRPCError } from '@trpc/server';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SIGN_IN_REFUSED_MESSAGE, TRPC_MAX_BATCH_SIZE } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import * as configManager from '../src/lib/configManager';
import * as emailHelpers from '../src/lib/emailHelpers';
import * as ldapAuth from '../src/lib/ldapAuth';
import { createContext } from '../src/lib/trpc';
import { appRouter, type AppRouter } from '../src/routers/index';

import { TEST_USER_PASSWORD, createCallerWithIP, createTestUser, lastAudit, setupTestDb, setAuthStrategy } from './helpers';

let prisma: PrismaClient;
let app: FastifyInstance;
let ip = 0;

beforeEach(async () => {
  prisma = await setupTestDb();
  app = Fastify();
  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      maxBatchSize: TRPC_MAX_BATCH_SIZE,
      createContext: async ({ req, res }) => createContext({ prisma, req, res }),
    } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

async function useStrategy(strategy: 'ldap-first' | 'local-first' | 'ldap-only') {
  await setAuthStrategy(prisma, strategy);
}

/** One `auth.login` over HTTP, from its own address unless `fromIp` is given. */
async function login(
  input: unknown,
  { fromIp = `10.25.0.${++ip}`, headers = {} }: { fromIp?: string; headers?: Record<string, string> } = {}
) {
  const response = await app.inject({
    method: 'POST',
    url: '/trpc/auth.login',
    remoteAddress: fromIp,
    headers: { 'content-type': 'application/json', ...headers },
    payload: JSON.stringify(input),
  });
  const body = response.json();
  delete body.error?.data?.stack;
  return { status: response.statusCode, body, headerNames: Object.keys(response.headers).sort() };
}

describe('every failure before proof is one answer', () => {
  it('over HTTP: the same status, body and header names, and each keeps its audit reason', async () => {
    const outcomes: Record<string, Awaited<ReturnType<typeof login>>> = {};

    await useStrategy('ldap-only');
    const { user: editor } = await createTestUser('editor');
    const { user: full } = await createTestUser('viewer');
    const ldap = vi.spyOn(ldapAuth, 'authenticateViaLdap');

    ldap.mockResolvedValue({ user: null, reason: 'invalid_credentials' });
    outcomes.wrongPassword = await login({ username: editor.username, password: 'Wrong-password-1!' });
    outcomes.unknownUser = await login({ username: 'nobody-here', password: 'Wrong-password-1!' });
    // `ldap-only`: a correct local password that is not an administrator's.
    outcomes.localNotAllowed = await login({ username: editor.username, password: TEST_USER_PASSWORD });

    ldap.mockRejectedValue(new TRPCError({ code: 'SERVICE_UNAVAILABLE', message: 'LDAP service unavailable' }));
    outcomes.ldapThrown = await login({ username: 'nobody-here', password: 'Wrong-password-1!' });

    ldap.mockResolvedValue({ user: null, reason: 'ldap_unavailable', errorCode: 'SERVICE_UNAVAILABLE' });
    outcomes.ldapReturned = await login({ username: 'nobody-here', password: 'Wrong-password-1!' });

    ldap.mockResolvedValue({ user: null, reason: 'invalid_credentials' });
    for (let i = 0; i < 10; i++) await login({ username: full.username, password: 'Wrong-password-1!' });
    outcomes.accountBucketFull = await login({ username: full.username, password: TEST_USER_PASSWORD });

    const [first, ...rest] = Object.values(outcomes);
    expect(first.status).toBe(401);
    expect(first.body.error).toMatchObject({ message: SIGN_IN_REFUSED_MESSAGE, data: { code: 'UNAUTHORIZED' } });
    expect(first.body.error.data).not.toHaveProperty('retryAfterSeconds');
    for (const outcome of rest) expect(outcome).toEqual(first);

    const reasons = (await prisma.auditLog.findMany({ where: { action: 'AUTH_LOGIN_FAILED' } })).map(
      row => (row.metadata as { reason?: string }).reason,
    );
    expect(new Set(reasons)).toEqual(
      new Set(['invalid_credentials', 'local_login_not_allowed', 'ldap_unavailable', 'rate_limited_username']),
    );
  });
});

describe("the caller's own request stays distinct", () => {
  it('a full per-IP bucket is a 429 carrying retryAfterSeconds', async () => {
    for (let i = 0; i < 5; i++) await login({ username: 'nobody-here', password: 'x' }, { fromIp: '10.25.9.1' });

    const throttled = await login({ username: 'nobody-here', password: 'x' }, { fromIp: '10.25.9.1' });

    expect(throttled.status).toBe(429);
    expect(throttled.body.error.data).toMatchObject({ code: 'TOO_MANY_REQUESTS', retryAfterSeconds: expect.any(Number) });
  });

  it.each([
    ['a malformed input', { username: 42 }, {}],
    ['a malformed Idempotency-Key', { username: 'nobody-here', password: 'x' }, { 'idempotency-key': 'not-a-uuid' }],
  ])('%s is a 400', async (_name, input, headers) => {
    const malformed = await login(input, { headers });

    expect(malformed.status).toBe(400);
    expect(malformed.body.error.data).toMatchObject({ code: 'BAD_REQUEST' });
  });
});

describe('after proof', () => {
  it('a directory that verified the password and could not write the user record is a 503', async () => {
    await useStrategy('ldap-first');
    vi.spyOn(ldapAuth, 'authenticateViaLdap').mockRejectedValue(
      new ldapAuth.LdapUserNotWrittenError(new Error('write failed')),
    );

    const unavailable = await login({ username: 'nobody-here', password: 'Wrong-password-1!' });

    expect(unavailable.status).toBe(503);
    expect(unavailable.body.error.data).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('a password reset request', () => {
  const GENERIC = { success: true };
  const request = async (email: string) =>
    (await createCallerWithIP(`10.25.1.${++ip}`, null)).auth.requestPasswordReset({ email });

  it('answers the same success when the link cannot be issued', async () => {
    const { user } = await createTestUser('viewer');
    vi.spyOn(emailHelpers, 'issueUserToken').mockRejectedValue(new Error('lock timeout'));

    await expect(request(user.email)).resolves.toMatchObject(GENERIC);
    const row = await lastAudit('PASSWORD_RESET_REQUESTED');
    expect(row).toMatchObject({ result: 'FAILURE', metadata: expect.objectContaining({ reason: 'token_issue_failed' }) });
  });

  it('answers the same success, leaving no link, when the base URL cannot be read', async () => {
    const { user } = await createTestUser('viewer');
    const read = configManager.getConfigOrDefault;
    vi.spyOn(configManager, 'getConfigOrDefault').mockImplementation(((db, key) =>
      key === 'app.baseUrl' ? Promise.reject(new Error('unreadable')) : read(db, key)) as typeof read);

    await expect(request(user.email)).resolves.toMatchObject(GENERIC);
    expect(await prisma.userToken.count({ where: { userId: user.id, type: 'RESET' } })).toBe(0);
  });
});
