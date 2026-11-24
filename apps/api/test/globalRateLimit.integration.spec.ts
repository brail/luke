/**
 * The global request limit (ADR-051, #239): a signed-in user's requests count in their own buckets —
 * essential (profile, token refresh, sign-out), background (heartbeat, SSE ticket), everything else —
 * so another user on the same address, or the user's own background traffic, never locks them out;
 * a request without a valid session counts per address. Limits come from `rateLimit.global`, set
 * here to their minimums (60 / 30 / 30 / 10 a minute) to keep the loops short.
 */

import { setTimeout as sleep } from 'node:timers/promises';

import rateLimit from '@fastify/rate-limit';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TRPC_MAX_BATCH_SIZE } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createToken } from '../src/lib/auth';
import * as configManager from '../src/lib/configManager';
import { setGlobalErrorHandler } from '../src/lib/error';
import { globalRateLimitOptions } from '../src/lib/globalRateLimit';
import { signJWT } from '../src/lib/jwt';
import * as tokenVersionCache from '../src/lib/tokenVersionCache';
import { createContext } from '../src/lib/trpc';
import { createTrustProxy } from '../src/lib/trustProxy';
import { appRouter, type AppRouter } from '../src/routers/index';

import { createTestUser, setupTestDb } from './helpers';

const LIMITS = { perUser: 60, perIp: 30, essentialPerUser: 30, backgroundPerUser: 10 };
const DEFAULTS = { perUser: 300, perIp: 100 };
const WEB_CIDR = '10.254.10.0/24';
const WEB_PEER = '10.254.10.5';
const CLIENT = '203.0.113.7';

let prisma: PrismaClient;
let app: FastifyInstance;
const log = { warn: vi.fn() };

beforeEach(async () => {
  prisma = await setupTestDb();
  log.warn.mockClear();
  await configManager.saveConfig(prisma, 'rateLimit.global', JSON.stringify(LIMITS));
});

/**
 * Starts the app and waits until the limiter has read its limits: until its first background read
 * completes it applies the defaults, so a test would otherwise spend its loop against them.
 */
async function start(expectedPerIp = LIMITS.perIp) {
  app = Fastify({ trustProxy: createTrustProxy(WEB_CIDR, 'production') });
  setGlobalErrorHandler(app);
  await app.register(rateLimit, globalRateLimitOptions(prisma, log));
  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      maxBatchSize: TRPC_MAX_BATCH_SIZE,
      createContext: async ({ req, res }) => createContext({ prisma, req, res }),
    } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    const probe = await app.inject({ method: 'GET', url: '/trpc/none.such', remoteAddress: '192.0.2.250' });
    if (probe.headers['x-ratelimit-limit'] === String(expectedPerIp)) return;
    await sleep(10);
  }
  throw new Error(`the limiter never applied ${expectedPerIp} a minute per address`);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

async function bearerFor(role: 'viewer' | 'editor' = 'viewer') {
  const { user } = await createTestUser(role);
  return { userId: user.id as string, bearer: createToken(user, Math.floor(Date.now() / 1000)) };
}

interface Call {
  url?: string;
  method?: 'GET' | 'POST';
  bearer?: string;
  from?: string;
  forwardedFor?: string;
}

/** One request; a procedure name no router has is the cheapest request in the normal lane. */
function send({ url = '/trpc/none.such', method = 'GET', bearer, from = CLIENT, forwardedFor }: Call = {}) {
  return app.inject({
    method,
    url,
    remoteAddress: from,
    headers: {
      ...(bearer && { authorization: `Bearer ${bearer}` }),
      ...(forwardedFor && { 'x-forwarded-for': forwardedFor }),
      ...(method === 'POST' && { 'content-type': 'application/json' }),
    },
    payload: method === 'POST' ? '{}' : undefined,
  });
}

/** Sends `count` requests and returns the status of the last. */
async function spend(count: number, call: Call = {}): Promise<number> {
  let status = 0;
  for (let i = 0; i < count; i++) status = (await send(call)).statusCode;
  return status;
}

describe('per-user buckets', () => {
  it('two users on one address are counted apart', async () => {
    await start();
    const a = await bearerFor();
    const b = await bearerFor();

    expect(await spend(LIMITS.perUser, { bearer: a.bearer })).not.toBe(429);
    expect((await send({ bearer: a.bearer })).statusCode).toBe(429);
    expect((await send({ bearer: b.bearer })).statusCode).not.toBe(429);
  });

  it('a user past the normal lane still loads the profile, refreshes and signs out', async () => {
    await start();
    const { bearer } = await bearerFor();
    await spend(LIMITS.perUser + 1, { bearer });

    expect((await send({ bearer, url: '/trpc/me.get' })).statusCode).toBe(200);
    expect((await send({ bearer, url: '/trpc/auth.refreshToken', method: 'POST' })).statusCode).toBe(200);
    expect((await send({ bearer, url: '/trpc/auth.logout', method: 'POST' })).statusCode).toBe(200);
  });

  it('background traffic past its lane leaves the essential and normal lanes alone', async () => {
    await start();
    const { bearer } = await bearerFor();

    expect(await spend(LIMITS.backgroundPerUser + 1, { bearer, url: '/trpc/users.heartbeat', method: 'POST' })).toBe(429);
    expect((await send({ bearer, url: '/trpc/notifications.getSseTicket', method: 'POST' })).statusCode).toBe(429);
    expect((await send({ bearer, url: '/trpc/me.get' })).statusCode).toBe(200);
    expect((await send({ bearer })).statusCode).not.toBe(429);
  });

  it('a mixed batch, an odd path and an encoded separator count as normal; a query string does not change a lane', async () => {
    await start();
    const { bearer } = await bearerFor();
    await spend(LIMITS.perUser + 1, { bearer });

    for (const url of [
      '/trpc/me.get,users.heartbeat?batch=1',
      '/trpc/me.get,',
      '/trpc/me.get%2Cauth.logout',
      '/trpc/',
    ]) {
      expect((await send({ bearer, url })).statusCode, url).toBe(429);
    }
    expect((await send({ bearer, url: '/trpc/me.get?batch=1&input=%7B%7D' })).statusCode).not.toBe(429);
  });

  it('server-to-server calls through the web are keyed by the user, not by the web address', async () => {
    await start();
    const a = await bearerFor();
    const b = await bearerFor();
    const viaWeb = { from: WEB_PEER, forwardedFor: CLIENT, url: '/trpc/auth.refreshToken', method: 'POST' } as const;

    expect(await spend(LIMITS.essentialPerUser, { ...viaWeb, bearer: a.bearer })).toBe(200);
    expect((await send({ ...viaWeb, bearer: a.bearer })).statusCode).toBe(429);
    expect((await send({ ...viaWeb, bearer: b.bearer })).statusCode).toBe(200);
  });
});

describe('per-address bucket', () => {
  it('requests without a session count per address', async () => {
    await start();
    expect(await spend(LIMITS.perIp)).toBe(404);
    expect((await send()).statusCode).toBe(429);
    expect((await send({ from: '198.51.100.20' })).statusCode).toBe(404);
  });

  it('requests without a session that come through the web count per client, not per web address', async () => {
    await start();
    const viaWeb = { from: WEB_PEER, url: '/trpc/auth.login', method: 'POST' } as const;

    await spend(LIMITS.perIp, { ...viaWeb, forwardedFor: CLIENT });
    expect((await send({ ...viaWeb, forwardedFor: CLIENT })).statusCode).toBe(429);
    expect((await send({ ...viaWeb, forwardedFor: '198.51.100.20' })).statusCode).not.toBe(429);
  });

  it('a token that cannot authenticate is keyed by address and never spends its user\'s buckets', async () => {
    await start();
    const { userId, bearer } = await bearerFor();
    const expired = signJWT({ userId, email: 'x@test.com', username: 'x', role: 'viewer', tokenVersion: 0, authTime: Math.floor(Date.now() / 1000) }, { expiresIn: '-1h' });
    const tampered = `${bearer.slice(0, -2)}xx`;
    const { bearer: revoked, userId: revokedId } = await bearerFor();
    await prisma.user.update({ where: { id: revokedId }, data: { tokenVersion: { increment: 1 } } });
    tokenVersionCache.invalidateTokenVersionCache(revokedId);

    for (const token of [expired, tampered, revoked]) await spend(LIMITS.perIp / 3, { bearer: token });
    expect((await send()).statusCode).toBe(429);
    expect((await send({ bearer })).statusCode).not.toBe(429);
  });
});

describe('a failed revocation check', () => {
  it('keeps each signed-in user in their own buckets, keyed by the signed identity', async () => {
    await start();
    const a = await bearerFor();
    const b = await bearerFor();
    vi.spyOn(tokenVersionCache, 'verifyTokenVersion').mockRejectedValue(new Error('database down'));

    await spend(LIMITS.perUser, { bearer: a.bearer });
    expect((await send({ bearer: a.bearer })).statusCode).toBe(429);
    expect((await send({ bearer: b.bearer })).statusCode).not.toBe(429);
    expect(log.warn).toHaveBeenCalledTimes(2); // one session-check warning per window, one refusal
  });
});

describe('configuration', () => {
  it('refuses a stored value below the minimums', async () => {
    await start();
    await expect(
      configManager.saveConfig(prisma, 'rateLimit.global', JSON.stringify({ ...LIMITS, perUser: 59 }))
    ).rejects.toThrow();
  });

  it('an invalid stored row falls back to the defaults', async () => {
    await prisma.appConfig.update({ where: { key: 'rateLimit.global' }, data: { value: '{"perUser":1}' } });
    await start(DEFAULTS.perIp);
    const { bearer } = await bearerFor();
    // 404: the unknown procedure answered, neither limited nor failed.
    expect(await spend(LIMITS.perUser + 1, { bearer })).toBe(404);
  });

  it('an unreadable row falls back to the defaults, never to an error', async () => {
    vi.spyOn(configManager, 'getConfigOrDefault').mockRejectedValue(new Error('database down'));
    await start(DEFAULTS.perIp);
    expect(await spend(LIMITS.perIp + 1)).toBe(404);
    expect(log.warn).toHaveBeenCalledWith(expect.anything(), 'Failed to read AppConfig rateLimit.global: the last or default limits apply');
  });
});

describe('the refusal', () => {
  it('answers TOO_MANY_REQUESTS with the seconds of Retry-After, without the address', async () => {
    await start();
    await spend(LIMITS.perIp);
    const response = await send();
    const body = response.json();

    expect(response.statusCode).toBe(429);
    expect(body.code).toBe('TOO_MANY_REQUESTS');
    expect(body.retryAfterSeconds).toBe(Number(response.headers['retry-after']));
    expect(JSON.stringify(body)).not.toContain(CLIENT);
  });

  it('is logged once at warn with the user, the lane and the procedures, never the query string', async () => {
    await start();
    const { userId, bearer } = await bearerFor();
    await spend(LIMITS.perUser, { bearer });
    await send({ bearer, url: '/trpc/none.such?input=%7B%22secret%22%3A1%7D' });

    expect(log.warn).toHaveBeenCalledTimes(1);
    const [fields] = log.warn.mock.calls[0] ?? [];
    expect(fields).toMatchObject({ lane: 'normal', userId, method: 'GET', path: '/trpc', procedures: ['none.such'] });
    expect(JSON.stringify(fields)).not.toContain('secret');
  });
});
