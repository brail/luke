/**
 * `withAuditLog` (apps/api/src/lib/auditMiddleware.ts) records a failed mutation as FAILURE.
 *
 * It used to wrap `next()` in `try { ... SUCCESS ... } catch { ... FAILURE ... }`. In tRPC 11 a
 * resolver error reaches a middleware as a resolved `{ ok: false }` result, whatever the adapter
 * (the caller still receives the rejection further up the chain), so the `catch` never ran and
 * every failed mutation of the users routers was logged as SUCCESS — found while testing
 * `users.forceLocalAccess`, kept here as an `it.fails` until the fix. The idempotency middleware
 * had the same blind spot (`idempotencyTrpc.ts`).
 */

import { describe, it, expect } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';


describe('withAuditLog — FAILURE detection', () => {
  it(
    'a mutation that throws without its own try/catch is logged as FAILURE',
    async () => {
      const prisma: PrismaClient = await setupTestDb();
      const { session } = await createTestUser('admin');
      const caller = createCallerWithSession(session);

      // `revokeUserSessions` has zero try/catch of its own: `NOT_FOUND` is a single,
      // unconditional, uncaught `throw`. The simplest possible case for this middleware.
      await expect(
        caller.users.revokeUserSessions({ id: '00000000-0000-0000-0000-000000000000' })
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });

      const row = await prisma.auditLog.findFirst({
        where: { action: 'USER_REVOKE_SESSIONS' },
        orderBy: { createdAt: 'desc' },
      });

      expect(row?.result).toBe('FAILURE');
    }
  );
});
