/**
 * The query values a Prisma validation error renders (`src/lib/queryArguments.ts`) reach neither the
 * log line of the failed call nor its FAILURE audit row, and the rejected row Postgres attaches to a
 * refusal does not reach the log line (#104). The errors come from the real client, in both forms it
 * renders, so a change of Prisma's format at an upgrade fails here first.
 */

import { TRPCError } from '@trpc/server';
import { describe, it, expect, vi } from 'vitest';

import { Prisma, type PrismaClient } from '@luke/db';

import { withAuditLog } from '../src/lib/auditMiddleware';
import { logTrpcError, toErrorMessage } from '../src/lib/error';
import { publicProcedure, router } from '../src/lib/trpc';

import { createTestContext, createTestUser, setupTestDb } from './helpers';
import { createTestPrismaClient } from './helpers/database';
import { captureLogger } from './helpers/logger';

const SENTINEL = 'query-value-sentinel';

const failing = router({
  find: publicProcedure
    .use(withAuditLog('PRISMA_VALIDATION_PROBE', 'User'))
    .mutation(({ ctx }) =>
      // Deliberately invalid — an argument the model does not have: the cast lets the call compile
      // so the client itself refuses it, which is the error under test.
      ctx.prisma.user.findFirst({ where: { username: SENTINEL, notAField: 'x' } as never })
    ),
});

describe('a Prisma validation error', () => {
  it('reaches neither the log line nor the FAILURE audit row with the query values', async () => {
    const prisma = await setupTestDb();
    const { session } = await createTestUser('admin');
    const { logger, lines } = captureLogger();

    const error: unknown = await failing.createCaller(createTestContext(session)).find().catch((e: unknown) => e);
    if (!(error instanceof TRPCError)) throw error;
    // What the tRPC `onError` in server.ts does with it.
    logTrpcError(logger, { path: 'find', error });

    expect(JSON.stringify(lines)).not.toContain(SENTINEL);
    expect(lines[0]?.err?.message).toContain('Invalid `ctx.prisma.user.findFirst()` invocation: Unknown argument `notAField`');

    const row = await prisma.auditLog.findFirst({ where: { action: 'PRISMA_VALIDATION_PROBE' } });
    expect(row?.result).toBe('FAILURE');
    expect(JSON.stringify(row?.metadata)).not.toContain(SENTINEL);
    expect(row?.metadata).toMatchObject({ errorMessage: expect.stringContaining('Unknown argument `notAField`') });
  });

  it('keeps the values out in the format production runs too', async () => {
    const production = clientBuiltForProduction();
    try {
      const error: unknown = await production.user
        // Deliberately invalid, as above: the client's own refusal is under test.
        .findFirst({ where: { username: SENTINEL, notAField: 'x' } as never })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Prisma.PrismaClientValidationError);
      const { logger, lines } = captureLogger();

      logger.error({ err: error }, 'failed');

      const message = toErrorMessage(error);
      expect(message).toContain('invocation: Unknown argument `notAField`');
      expect(message).not.toContain(SENTINEL);
      expect(JSON.stringify(lines)).not.toContain(SENTINEL);
    } finally {
      await production.$disconnect();
    }
  });
});

describe('a Postgres refusal', () => {
  it('reaches the log line without the rejected row the database attaches to it', async () => {
    const prisma = await setupTestDb();
    const { logger, lines } = captureLogger();

    const error: unknown = await prisma.companyProfile
      // Only the singleton id passes the table's CHECK: Postgres refuses the row and quotes it in `detail`.
      .create({ data: { id: 'not-the-singleton', legalName: SENTINEL, displayName: 'x' } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);

    logger.error({ err: error }, 'failed');

    expect(JSON.stringify(lines)).not.toContain(SENTINEL);
    // The rest of the adapter's answer stays.
    expect(JSON.stringify(lines)).toContain('"kind":"postgres"');
  });
});

/** A client built as production builds it: Prisma picks its `minimal` error format from `NODE_ENV`. */
function clientBuiltForProduction(): PrismaClient {
  vi.stubEnv('NODE_ENV', 'production');
  try {
    return createTestPrismaClient();
  } finally {
    vi.unstubAllEnvs();
  }
}
