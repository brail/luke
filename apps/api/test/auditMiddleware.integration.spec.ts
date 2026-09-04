/**
 * `withAuditLog` (apps/api/src/lib/auditMiddleware.ts) — systemic bug discovered while writing
 * tests for `users.forceLocalAccess`/`revokeLocalAccess` (unrelated feature). Not fixed here per
 * the test-writer skill's own rule: flag it and write the failing test, the decision to change
 * application code belongs to the user.
 *
 * `withAuditLog` wraps `next()` in `try { ... SUCCESS ... } catch { ... FAILURE ... }`, assuming
 * `next()` rejects when the wrapped mutation resolver throws. Reproduced here with the simplest
 * possible case — `users.revokeUserSessions`, a resolver with a single unconditional
 * `throw new TRPCError({ code: 'NOT_FOUND' })` and *no* try/catch of its own — and confirmed by
 * temporarily instrumenting `withAuditLog` itself: `next()` resolves normally even though the
 * mutation demonstrably threw (the caller *does* receive the NOT_FOUND rejection — the error
 * propagates correctly to the end caller through the rest of the middleware chain). Only
 * `withAuditLog`'s own `try/catch` fails to observe it, so every failed mutation that uses this
 * middleware is being logged as `result: 'SUCCESS'` in `AuditLog` instead of `'FAILURE'`.
 *
 * Impact: `withAuditLog` is used across most mutation routers in this codebase (users, config,
 * calendar, pricing, ...). If this reproduces over real HTTP too (not just the `createCaller`
 * path every integration test in this suite uses — that distinction is NOT yet verified, see the
 * open question below), the audit trail for every failed mutation using it is silently wrong:
 * `AuditLog.result` says `SUCCESS` for actions that failed. This is a compliance/forensic
 * integrity issue, not a cosmetic one — `maintenance.audit_log` is a section admins rely on.
 *
 * Open question this test does not answer: whether the same happens over the real Fastify HTTP
 * adapter, or is specific to the `createCaller` direct-invocation path used by every test in this
 * suite (in which case the bug would instead be "the whole withAuditLog test surface is blind",
 * a smaller but still real problem). Worth checking with a real HTTP request before deciding how
 * to fix it.
 */

import { describe, it, expect } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';


describe('withAuditLog — FAILURE detection', () => {
  it.fails(
    'un mutation che throw senza try/catch proprio → dovrebbe loggare FAILURE, non SUCCESS (bug: vedi header file)',
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
