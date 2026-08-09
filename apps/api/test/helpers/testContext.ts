/**
 * Helper to create a test context for tRPC.
 *
 * The session points to a user **actually present in the database**: production
 * routers use `protectedProcedure`, which validates `tokenVersion` against the
 * user row. With a fake session (`id: 'test-user-id'`) every call used to fail
 * with "Session expired" — the reason the specs had gotten into the habit of
 * duplicating routers using `publicProcedure`.
 */

import { randomUUID } from 'crypto';

import type { Role } from '@luke/core';

import { ensureTestSchema, getTestPrismaClient, resetTestData } from './database';
import { createSilentLogger } from './logger';

import type { Context } from '../../src/lib/trpc';

/**
 * Creates a test context with a real user of the requested role.
 *
 * Truncates the data before building the context, so every test starts from an
 * empty database. It's not redundant with specs that already call
 * `resetTestData()`: isolation used to be a per-file convention, and it only
 * took one file without initial cleanup to inherit the rows from the previous
 * one. It really happened — `brand.integration.spec.ts` had no `afterEach` and
 * left behind a brand with a fixed code, which made subsequent suites fail
 * with P2002. On an already populated database the defect wasn't visible; it
 * only surfaced in CI, on the first genuinely empty database.
 *
 * The name states the parameter on purpose. It used to be called
 * `createTestContext`, like the **synchronous** helper in `test/helpers.ts`
 * that takes a `UserSession` and doesn't touch the database: two same-named
 * functions with incompatible semantics, chosen by import. With distinct
 * names, any confusion becomes a compile error — wrong import, wrong argument,
 * or a missing `await` (a `Promise<Context>` doesn't have `.prisma`).
 *
 * @param role - Role of the session user. Default `admin`.
 */
export async function createContextForRole(
  role: Role = 'admin'
): Promise<Context> {
  // Shared client from the test file, not a new one: every client opens its
  // own pool. And the schema must be guaranteed here — specs that use only
  // this helper don't call `setupTestDb()`, so without `ensureTestSchema` they
  // only worked by luck, when another suite had already created the tables.
  const prisma = getTestPrismaClient();
  await ensureTestSchema(prisma);
  await resetTestData(prisma);

  const uid = randomUUID().substring(0, 8);
  const user = await prisma.user.create({
    data: {
      email: `ctx-${role}-${uid}@test.com`,
      username: `ctx-${role}-${uid}`,
      firstName: 'Ctx',
      lastName: 'Test',
      role,
      isActive: true,
    },
  });

  const session = {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      tokenVersion: user.tokenVersion,
    },
  };

  // Mock request and response
  const mockReq = {
    log: createSilentLogger(),
    headers: {},
    ip: '127.0.0.1',
  } as any;

  const mockRes = {} as any;

  return {
    prisma,
    session,
    req: mockReq,
    res: mockRes,
    traceId: randomUUID(),
    logger: mockReq.log,
  };
}
