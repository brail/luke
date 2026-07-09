/**
 * Session-scoped edit lock for the planning wizard. Distinct from `CalendarEventStateEffect`
 * (a domain-level lock triggered by milestone events) — this is a UI-session lock held by a
 * single user while the wizard is open, released on completion/unmount or expired via a fixed
 * TTL (no renewal/heartbeat).
 */

import { TRPCError } from '@trpc/server';

import type { LockEntityType, PrismaClient } from '@prisma/client';

const LOCK_TTL_MS = 15 * 60 * 1000;

type Lock = { expiresAt: Date; lockedByUserId: string };

/** True when `lock` is still valid (not expired) and held by someone other than `userId`. */
function isLockedByOther(lock: Lock | null, userId: string): boolean {
  return !!lock && lock.expiresAt > new Date() && lock.lockedByUserId !== userId;
}

/**
 * Acquires (or renews, if already held by the same user) a lock on the given entity.
 * Throws CONFLICT if another user currently holds a non-expired lock on it.
 */
export async function acquireLock(
  entityType: LockEntityType,
  entityId: string,
  userId: string,
  prisma: PrismaClient
) {
  const now = new Date();
  const existing = await prisma.editLock.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
  });
  if (isLockedByOther(existing, userId)) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Elemento in modifica da un altro utente' });
  }

  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
  return prisma.editLock.upsert({
    where: { entityType_entityId: { entityType, entityId } },
    create: { entityType, entityId, lockedByUserId: userId, lockedAt: now, expiresAt },
    update: { lockedByUserId: userId, lockedAt: now, expiresAt },
  });
}

/** Releases a lock — no-op if the caller doesn't currently hold it. */
export async function releaseLock(
  entityType: LockEntityType,
  entityId: string,
  userId: string,
  prisma: PrismaClient
) {
  await prisma.editLock.deleteMany({ where: { entityType, entityId, lockedByUserId: userId } });
}

/**
 * Throws CONFLICT if the entity is currently locked by a different user. Called by mutation
 * handlers on `SeasonCalendar`/`CalendarEvent` and `CollectionLayout`/rows to block concurrent
 * edits while a planning wizard session is open.
 */
export async function assertUnlocked(
  entityType: LockEntityType,
  entityId: string,
  userId: string,
  prisma: PrismaClient
) {
  const lock = await prisma.editLock.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
  });
  if (isLockedByOther(lock, userId)) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Pianificazione in corso da un altro utente — riprova più tardi',
    });
  }
}
