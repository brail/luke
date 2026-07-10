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
 * Acquires locks on multiple entities atomically — if any is held by another user, none are
 * written. Used by the planning wizard, which needs a `SeasonCalendar` + `CollectionLayout` lock
 * together: acquiring them one at a time could leave one lock held and the other rejected, with
 * no rollback of the first.
 *
 * @throws {TRPCError} CONFLICT if any entity is currently locked by a different user.
 */
export async function acquireLocks(
  entities: { entityType: LockEntityType; entityId: string }[],
  userId: string,
  prisma: PrismaClient
) {
  return prisma.$transaction(async tx => {
    const now = new Date();
    // One query for all entities (not N) — `entityType_entityId` pairs only need an OR filter,
    // and this runs on a single-connection interactive transaction anyway, so N parallel
    // `findUnique`s wouldn't even overlap on the wire.
    const existingLocks = await tx.editLock.findMany({
      where: { OR: entities.map(e => ({ entityType: e.entityType, entityId: e.entityId })) },
    });
    if (existingLocks.some(lock => isLockedByOther(lock, userId))) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Elemento in modifica da un altro utente' });
    }

    const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
    return Promise.all(entities.map(e => tx.editLock.upsert({
      where: { entityType_entityId: { entityType: e.entityType, entityId: e.entityId } },
      create: { entityType: e.entityType, entityId: e.entityId, lockedByUserId: userId, lockedAt: now, expiresAt },
      update: { lockedByUserId: userId, lockedAt: now, expiresAt },
    })));
  });
}

/** Releases locks on one or more entities in a single query — no-op for any the caller doesn't hold. */
export async function releaseLocks(
  entities: { entityType: LockEntityType; entityId: string }[],
  userId: string,
  prisma: PrismaClient
) {
  await prisma.editLock.deleteMany({
    where: {
      lockedByUserId: userId,
      OR: entities.map(e => ({ entityType: e.entityType, entityId: e.entityId })),
    },
  });
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
