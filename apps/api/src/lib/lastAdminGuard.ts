import { TRPCError } from '@trpc/server';

import { getRbacConfig } from '@luke/core/server';

import { countAdminsWithSettingsAccessAfterChange } from '../services/sectionAccess.service';

import type { Prisma } from '@prisma/client';

const LAST_ADMIN_LOCK_KEY = 'last-admin-guard';

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

/** Throws FORBIDDEN if fewer than 2 active admins remain. Call after acquiring the lock. */
export async function assertNotLastAdmin(
  tx: Prisma.TransactionClient,
  message: string
): Promise<void> {
  await acquireLastAdminLock(tx);

  const adminCount = await tx.user.count({
    where: { role: 'admin', isActive: true },
  });

  if (adminCount <= 1) {
    throw new TRPCError({ code: 'FORBIDDEN', message });
  }
}

/**
 * Same as `assertNotLastAdmin`, but also checks effective `settings` section
 * access (kill switch + role defaults + personal overrides), not just role
 * count. Demoting/deactivating/deleting `userId` must never leave zero
 * admins able to reach Settings — the only in-app place to undo an RBAC
 * misconfiguration (see `sectionAccess.ts`'s `set`/`setRoleDefaults` guards,
 * which check the same invariant from the other direction).
 */
export async function assertNotLastAdminWithSettingsAccess(
  tx: Prisma.TransactionClient,
  userId: string,
  message: string
): Promise<void> {
  await assertNotLastAdmin(tx, message);

  const { sectionAccessDefaults, disabledSections } = await getRbacConfig(tx, {
    bypassCache: true,
  });
  const survivingAdmins = await countAdminsWithSettingsAccessAfterChange(
    tx,
    userId,
    false, // demoting/deactivating/deleting this user removes their access outright
    sectionAccessDefaults,
    disabledSections
  );

  if (survivingAdmins === 0) {
    throw new TRPCError({ code: 'FORBIDDEN', message });
  }
}
