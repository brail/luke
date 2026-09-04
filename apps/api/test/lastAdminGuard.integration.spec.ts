/**
 * `lastAdminGuard` — real enforcement through the tRPC endpoints, not against
 * a mock. `sectionAccess.spec.ts` only exercises `countAdminsWithSettingsAccess`
 * with a fake `PrismaClient`: no test touches `assertNotLastAdminWithSettingsAccess`,
 * `acquireLastAdminLock`, or the real transaction of `users.update`/`softDelete`/
 * `hardDelete`. This suite covers both, including the race that
 * `pg_advisory_xact_lock` exists to close: two concurrent mutations that,
 * read in isolation, would both see "2 admins" and would both pass,
 * driving the system to zero admins.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { acquireLastAdminLock } from '../src/lib/lastAdminGuard';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;

function callerFor(session: UserSession) {
  return createCallerWithSession(session).users;
}

const LAST_ADMIN_MESSAGE =
  "Non puoi rimuovere i privilegi amministrativi dall'ultimo amministratore del sistema";

// `beforeEach`, not `beforeAll`: the admins created by one test remain active in
// the file's shared DB (no truncate between tests) and would add up to the next
// test's global count — the concurrency test below assumes exactly
// two active admins in the world, not "two plus whatever previous tests left behind".
beforeEach(async () => {
  prisma = await setupTestDb();
});

describe('lastAdminGuard — enforcement reale', () => {
  it('editor con users:update NON può disattivare l\'unico admin rimasto', async () => {
    const { session: editorSession } = await createTestUser('editor');
    const { user: admin } = await createTestUser('admin');

    await expect(
      callerFor(editorSession).update({ id: admin.id, isActive: false })
    ).rejects.toMatchObject({ code: 'FORBIDDEN', message: LAST_ADMIN_MESSAGE });

    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(refreshed.isActive).toBe(true);
  });

  it('editor con users:update PUÒ disattivare un admin se ne resta almeno un altro attivo', async () => {
    const { session: editorSession } = await createTestUser('editor');
    const { user: admin1 } = await createTestUser('admin');
    await createTestUser('admin'); // second admin: keeps the system above the threshold

    await callerFor(editorSession).update({ id: admin1.id, isActive: false });

    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: admin1.id } });
    expect(refreshed.isActive).toBe(false);
  });

  /**
   * Regression: the first version of the guard only checked the `settings`
   * section, and removing `settings.users` from the last admin passed without
   * any obstacle. The Users menu entry is gated on
   * `settings && settings['settings.users']` (`useMenuAccess.ts`) and that
   * section maps to `users:read`: whoever loses it can no longer create or
   * promote anyone, so it's the same lockout as `settings`, through another
   * door. Found by testing manually on RC, not by a test.
   */
  describe('sezioni di recupero', () => {
    it.each(['settings', 'settings.users'] as const)(
      "togliere '%s' all'unico admin è rifiutato",
      async section => {
        const { user: admin, session } = await createTestUser('admin');

        await expect(
          createCallerWithSession(session).sectionAccess.set({
            userId: admin.id,
            section,
            enabled: false,
          })
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }
    );

    it.each(['settings', 'settings.users'] as const)(
      "togliere '%s' a un admin è consentito se ne resta un altro",
      async section => {
        const { user: target, session } = await createTestUser('admin');
        await createTestUser('admin'); // the way out

        await expect(
          createCallerWithSession(session).sectionAccess.set({
            userId: target.id,
            section,
            enabled: false,
          })
        ).resolves.toBeDefined();
      }
    );
  });

  it(
    'acquireLastAdminLock serializza due transazioni concorrenti sulla stessa chiave ' +
      '(pg_advisory_xact_lock, non un mutex applicativo — sopravvive a più repliche API)',
    async () => {
      // Direct test of mutual exclusion on the real primitive used by all three
      // endpoints (`users.update`/`softDelete`/`hardDelete`, see grep in
      // `src/routers/users.core.router.ts` and `src/services/users.service.ts`).
      // An end-to-end test with two concurrent `users.update` calls was dropped after
      // empirical verification: without forcing the overlap window, the two
      // transactions never overlap enough for both to run the SELECT
      // before the first one COMMITs — the test passed identically even with
      // `acquireLastAdminLock` temporarily disabled (false positive). `pg_sleep`
      // inside the transaction holding the lock deterministically forces the
      // overlap, unlike a plain `Promise.allSettled` over two
      // real calls.
      const order: string[] = [];

      const txA = prisma.$transaction(async tx => {
        await acquireLastAdminLock(tx);
        order.push('A-acquired');
        await tx.$executeRaw`SELECT pg_sleep(0.3)`;
        order.push('A-releasing');
      });

      // Ensures A has already acquired the lock before B tries — otherwise
      // the arrival order of the two transactions on the same key isn't guaranteed
      // and the test would become flaky.
      await new Promise(resolve => setTimeout(resolve, 100));

      const txB = prisma.$transaction(async tx => {
        await acquireLastAdminLock(tx);
        order.push('B-acquired');
      });

      await Promise.all([txA, txB]);

      // B cannot acquire the lock until A's transaction ends (the advisory
      // lock is xact-scoped: it's released only on COMMIT/ROLLBACK) — if the lock
      // didn't serialize, B could interleave before 'A-releasing'.
      expect(order).toEqual(['A-acquired', 'A-releasing', 'B-acquired']);
    }
  );
});
