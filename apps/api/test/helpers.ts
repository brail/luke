/**
 * Test Helpers for Luke API
 * Utilities for mock context, caller factory and isolated DB management
 */

import { randomUUID } from 'crypto';

import helmet from '@fastify/helmet';
import { PrismaClient } from '@prisma/client';
import Fastify from 'fastify';

import { buildHelmetConfig } from '../src/lib/helmet';
import { hashPassword } from '../src/lib/password';
import { type Context } from '../src/lib/trpc';
import { appRouter } from '../src/routers/index';

import { setupTestDb as setupSharedTestDb } from './helpers/database';
import { createSilentLogger } from './helpers/logger';

import type { UserSession } from '../src/lib/auth';

/**
 * Isolated test database
 */
let testPrisma: PrismaClient;

/**
 * Initializes the test database.
 * Delegates to `helpers/database.ts`, the single source for the URL and schema reset.
 */
export async function setupTestDb(): Promise<PrismaClient> {
  testPrisma = await setupSharedTestDb();
  return testPrisma;
}

/**
 * Password for test users. Needed by tests that exercise `me.changePassword`:
 * without a local credential the router responds FORBIDDEN ("password change
 * not allowed for external providers") instead of UNAUTHORIZED, and the test
 * ends up measuring the wrong branch.
 */
export const TEST_USER_PASSWORD = 'TestPassw0rd!23';

/**
 * Hash of the test password, computed once per file.
 *
 * `ARGON2_OPTIONS` is tuned for production (64 MB, 3 iterations): ~90ms per
 * hash. The password is a constant, so redoing the hash on every
 * `createTestUser` meant ~3s per integration run to produce the same result
 * dozens of times over. Memoizes the promise, not the string: concurrent
 * calls share the same computation instead of each starting their own.
 */
let testPasswordHash: Promise<string> | null = null;

function getTestPasswordHash(): Promise<string> {
  testPasswordHash ??= hashPassword(TEST_USER_PASSWORD);
  return testPasswordHash;
}

/**
 * Creates a test user with the specified role, complete with local identity
 * and credential — i.e. a real local user, not a shell.
 */
export async function createTestUser(
  role: 'admin' | 'editor' | 'viewer'
): Promise<{
  user: any;
  session: UserSession;
}> {
  // Generates unique identifiers using timestamp + random
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  const uniqueId = `${timestamp}-${random}`;
  
  const user = await testPrisma.user.create({
    data: {
      email: `${role}-${uniqueId}@test.com`,
      username: `${role}-${uniqueId}`,
      firstName: role.charAt(0).toUpperCase() + role.slice(1),
      lastName: 'User',
      role,
      isActive: true,
      emailVerifiedAt: new Date(), // Field required for tests
    },
  });

  // Creates local identity + credential for the user
  const identity = await testPrisma.identity.create({
    data: {
      userId: user.id,
      provider: 'LOCAL',
      providerId: `${role}-${uniqueId}`, // Ensures uniqueness
    },
  });

  await testPrisma.localCredential.create({
    data: {
      identityId: identity.id,
      passwordHash: await getTestPasswordHash(),
    },
  });

  const session: UserSession = {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: 0,
    },
  };

  return { user, session };
}

/**
 * Creates a test context with an optional session
 */
export function createTestContext(session: UserSession | null = null): Context {
  return {
    prisma: testPrisma,
    session,
    logger: createSilentLogger(),
    req: {
      headers: { 'x-luke-trace-id': randomUUID() },
      ip: '127.0.0.1',
      log: createSilentLogger(),
    } as any,
    res: {} as any,
    traceId: randomUUID(),
  };
}

/**
 * Creates a tRPC caller for a specific role
 */
export async function createCallerAs(
  role: 'admin' | 'editor' | 'viewer' | null
) {
  if (role === null) {
    // No session (unauthenticated)
    const ctx = createTestContext(null);
    return appRouter.createCaller(ctx);
  }

  // Creates user and session for the role
  const { session } = await createTestUser(role);
  const ctx = createTestContext(session);
  return appRouter.createCaller(ctx);
}

/**
 * Creates a tRPC caller with a specific session
 */
export function createCallerWithSession(session: UserSession) {
  const ctx = createTestContext(session);
  return appRouter.createCaller(ctx);
}

/**
 * Creates a tRPC caller without authentication
 */
export function createAnonymousCaller() {
  return createCallerAs(null);
}

/**
 * Creates a tRPC caller with a specific idempotency-key
 */
export async function createCallerWithIdempotency(
  idempotencyKey: string,
  role: 'admin' | 'editor' | 'viewer' | null = null
) {
  const base = role
    ? createTestContext((await createTestUser(role)).session)
    : createTestContext(null);
  const ctx: Context = {
    ...base,
    req: {
      ...base.req,
      headers: { ...base.req.headers, 'idempotency-key': idempotencyKey },
    },
  };
  return appRouter.createCaller(ctx);
}

/**
 * Creates a tRPC caller with a specific IP (for rate-limit tests)
 */
export async function createCallerWithIP(
  ip: string,
  role: 'admin' | 'editor' | 'viewer' | null = null
) {
  const base = role
    ? createTestContext((await createTestUser(role)).session)
    : createTestContext(null);
  const ctx: Context = { ...base, req: { ...base.req, ip } };
  return appRouter.createCaller(ctx);
}

/**
 * Helper to wait for a promise to resolve or reject
 */
export async function expectToThrow<T>(
  promise: Promise<T>,
  expectedError?: { code?: string; message?: string }
): Promise<void> {
  // The "didn't throw" case must be distinguished BEFORE entering the catch:
  // the previous version threw inside the `try`, its own `catch` intercepted
  // that Error (which has no `.code`) and reported "Expected error code 'X',
  // got 'undefined'" — i.e. an error-code failure instead of "the promise
  // resolved". Wrong diagnosis on every test of this kind.
  let caught: any;
  let threw = false;

  try {
    await promise;
  } catch (error) {
    threw = true;
    caught = error;
  }

  if (!threw) {
    throw new Error('Expected promise to throw, but it resolved');
  }

  if (expectedError) {
    if (expectedError.code && caught.code !== expectedError.code) {
      throw new Error(
        `Expected error code '${expectedError.code}', got '${caught.code}'`
      );
    }
    if (
      expectedError.message &&
      !caught.message.includes(expectedError.message)
    ) {
      throw new Error(
        `Expected error message to contain '${expectedError.message}', got '${caught.message}'`
      );
    }
  }
}

/**
 * Helper to verify that an operation is denied
 */
export async function expectUnauthorized(
  operation: () => Promise<any>,
  expectedCode: 'UNAUTHORIZED' | 'FORBIDDEN' = 'FORBIDDEN'
): Promise<void> {
  try {
    await operation();
    throw new Error('Expected operation to be unauthorized, but it succeeded');
  } catch (error: any) {
    if (error.code !== expectedCode) {
      throw new Error(
        `Expected error code '${expectedCode}', got '${error.code}': ${error.message}`
      );
    }
  }
}

/**
 * Creates an isolated Fastify server for HTTP tests
 * Registers only the essential plugins to test security headers
 */
export async function buildTestServer() {
  const fastify = Fastify({
    logger: false, // Disables logging for tests
  });

  // Registers Helmet with test configuration
  await fastify.register(helmet, buildHelmetConfig('test'));

  // Registers test route to verify headers
  fastify.get('/api/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: 'test',
      environment: 'test',
    };
  });

  // Root route for tests
  fastify.get('/', async () => {
    return {
      message: 'Luke API Test Server',
      version: 'test',
    };
  });

  await fastify.ready();
  return fastify;
}

/**
 * Re-exports of the modules under `helpers/`, which make this file the
 * single barrel for the test surface.
 *
 * **They are load-bearing even if no spec imports from here.** They aren't
 * for convenience: they're there to make name collisions collide. Two
 * same-named helpers in different files become a compile error here,
 * instead of two imports that look interchangeable and aren't. This already
 * happened — `createTestContext` existed synchronously in this file (takes
 * a `UserSession`, doesn't touch the database) and asynchronously in
 * `helpers/testContext.ts` (creates a real user and truncates data), and
 * the choice between the two depended on which path you'd imported.
 *
 * Explicit, not `export *`: `export *` collisions fall under TS2308, which
 * has edge cases in ambiguity resolution; a duplicate explicit re-export is
 * a clean, immediate error.
 *
 * When adding an export to a `helpers/` module, add it here too — that's
 * what keeps the check active.
 */
export { createContextForRole } from './helpers/testContext';
export { createSilentLogger } from './helpers/logger';
export {
  getTestDatabaseUrl,
  createTestPrismaClient,
  getTestPrismaClient,
  ensureTestSchema,
  resetTestData,
  disconnectTestDb,
} from './helpers/database';
export {
  MockStorageProvider,
  createTestContextWithMockStorage,
  createTestFile,
  createValidPngBuffer,
  createValidJpegBuffer,
  createValidWebpBuffer,
  createInvalidImageBuffer,
  seedLocalStorageConfig,
} from './helpers/storageTestHelper';
