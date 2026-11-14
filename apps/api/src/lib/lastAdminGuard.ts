import { TRPCError } from '@trpc/server';

import { getRbacConfig } from '@luke/core/server';
import type { Prisma } from '@luke/db';

import { countRecoveryCapableAdminsAfterChange } from '../services/sectionAccess.service';

import { APPROVED_ADMIN_WHERE } from './approvedUsers';
import { lockUserEmail } from './emailHelpers';


/** The advisory lock's key, exported for the tests that hold it. */
export const LAST_ADMIN_LOCK_KEY = 'last-admin-guard';

/**
 * Acquires the shared advisory lock that serializes every mutation able to
 * drop the system to zero admins. Must run inside a `$transaction` callback —
 * the lock is scoped to the transaction and releases on commit/rollback, so a
 * bare `PrismaClient` call would acquire and release it within a single
 * statement, guarding nothing.
 */
export async function acquireLastAdminLock(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LAST_ADMIN_LOCK_KEY}))`;
}

/**
 * Throws FORBIDDEN if fewer than 2 active, approved admins remain. A pending admin cannot sign in,
 * so it does not count. Call after acquiring the lock.
 */
export async function assertNotLastAdmin(
  tx: Prisma.TransactionClient,
  message: string
): Promise<void> {
  await acquireLastAdminLock(tx);

  const adminCount = await tx.user.count({
    where: APPROVED_ADMIN_WHERE,
  });

  if (adminCount <= 1) {
    throw new TRPCError({ code: 'FORBIDDEN', message });
  }
}

/**
 * Same as `assertNotLastAdmin`, but also checks effective access to
 * `ADMIN_RECOVERY_SECTION` (kill switch + role defaults + personal
 * overrides), not just role count. Demoting/deactivating/deleting `userId` must
 * never leave zero admins able to administer users — the only in-app path to
 * undo an RBAC misconfiguration (see the guards `set`/`setRoleDefaults` in
 * `sectionAccess.ts`, which check the same invariant from the other side).
 * Takes the lock itself, then locks and reads `userId`: a user who is not an active, approved admin
 * is not counted, so removing one is never refused.
 */
export async function assertNotLastAdminWithSettingsAccess(
  tx: Prisma.TransactionClient,
  userId: string,
  message: string
): Promise<void> {
  await acquireLastAdminLock(tx);
  // The target's row too, in the order every path that takes both uses: an approval or a
  // reactivation of it, which does not take the advisory lock, waits until this transaction ends.
  await lockUserEmail(tx, userId);
  // Only an active, approved admin is counted, so removing anyone else leaves the count as it is.
  const counted = await tx.user.count({ where: { id: userId, ...APPROVED_ADMIN_WHERE } });
  if (counted === 0) return;

  await assertNotLastAdmin(tx, message);

  const { sectionAccessDefaults, disabledSections } = await getRbacConfig(tx, {
    bypassCache: true,
  });
  const survivingAdmins = await countRecoveryCapableAdminsAfterChange(
    tx,
    userId,
    // `null`: demoting/deactivating/deleting removes every section at once, not
    // a specific section.
    null,
    null,
    sectionAccessDefaults,
    disabledSections
  );

  if (survivingAdmins === 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message });
  }
}
