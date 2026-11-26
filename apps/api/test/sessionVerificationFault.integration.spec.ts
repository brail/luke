/**
 * A server fault while verifying a bearer fails the request; it never reads as an ended session
 * (#299, ADR-052): the web signs out only on `data.sessionEnded`. Real global limiter, tRPC adapter
 * and `createContext`, plus one raw upload route. `verifyJWT` throws as it does when the secret
 * cannot be derived (`jwtVerification.spec.ts` proves that part); the setup files load the routers
 * before a module mock could apply, so the fault is injected at `verifyJWT` itself.
 */

import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from '@trpc/server/adapters/fastify';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TRPC_MAX_BATCH_SIZE } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createToken } from '../src/lib/auth';
import { setGlobalErrorHandler } from '../src/lib/error';
import { globalRateLimitOptions } from '../src/lib/globalRateLimit';
import * as jwtModule from '../src/lib/jwt';
import { createContext } from '../src/lib/trpc';
import { appRouter, type AppRouter } from '../src/routers/index';
import brandLogoRoutes from '../src/routes/brandLogo.routes';

import { createTestUser, setupTestDb } from './helpers';
import { multipartRequest, pngPart } from './helpers/multipart';

/** From now on, verifying a bearer fails as a server fault does. */
function verificationFaults() {
  vi.spyOn(jwtModule, 'verifyJWT').mockImplementation(() => {
    throw new Error('Unable to derive API JWT secret from master key');
  });
}

let prisma: PrismaClient;
let app: FastifyInstance;

beforeEach(async () => {
  prisma = await setupTestDb();
  app = Fastify({ logger: false });
  setGlobalErrorHandler(app);
  await app.register(cookie);
  await app.register(rateLimit, globalRateLimitOptions(prisma, { warn: vi.fn() }));
  await app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      maxBatchSize: TRPC_MAX_BATCH_SIZE,
      createContext: async ({ req, res }) => createContext({ prisma, req, res }),
    } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
  });
  await app.register(multipart);
  await app.register(brandLogoRoutes, { prisma });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

/** A valid bearer. */
async function bearer(role: 'admin' | 'viewer' = 'viewer') {
  const { user } = await createTestUser(role);
  return `Bearer ${createToken({ ...user, tokenVersion: user.tokenVersion ?? 0 }, Math.floor(Date.now() / 1000))}`;
}

describe('a server fault while verifying the bearer', () => {
  const garbled = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from('not json').toString('base64url')}.sig`;

  it.each([
    ['malformed', 'not-a-token'],
    ['whose payload is not JSON', garbled],
  ])('a refused bearer, %s, still ends the session', async (_label, token) => {
    const response = await app.inject({ method: 'GET', url: '/trpc/me.get', headers: { authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.data).toMatchObject({ sessionEnded: true });
  });

  it('a single call answers 500, without sessionEnded, and runs no procedure', async () => {
    const authorization = await bearer();
    verificationFaults();
    const read = vi.spyOn(prisma.user, 'findUnique');

    const response = await app.inject({ method: 'GET', url: '/trpc/me.get', headers: { authorization } });

    expect(response.statusCode).toBe(500);
    expect(response.json().error.data).toMatchObject({ code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 });
    expect(response.json().error.data).not.toHaveProperty('sessionEnded');
    expect(read).not.toHaveBeenCalled();
  });

  it('a streamed batch answers every call with a server error, without sessionEnded', async () => {
    const authorization = await bearer();
    verificationFaults();

    const response = await app.inject({
      method: 'GET',
      url: `/trpc/context.get,catalog.brands?batch=1&input=${encodeURIComponent('{}')}`,
      headers: { authorization, 'trpc-accept': 'application/jsonl' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('sessionEnded');
    expect(response.body.match(/"code":"INTERNAL_SERVER_ERROR"/g)).toHaveLength(2);
    expect(response.body.match(/"httpStatus":500/g)).toHaveLength(2);
  });

  it('a raw upload route answers 500, not 401', async () => {
    const authorization = await bearer('admin');
    verificationFaults();

    const response = await app.inject({
      method: 'POST',
      url: '/upload/brand-logo/temp',
      ...(await multipartRequest([pngPart('logo.png')], { authorization })),
    });

    expect(response.statusCode).toBe(500);
    expect(await prisma.fileObject.count()).toBe(0);
  });
});
