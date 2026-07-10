/**
 * Session-scoped edit lock for the planning wizard. Distinct from `CalendarEventStateEffect`
 * (a domain-level lock triggered by milestone events) — this is a UI-session lock held by a
 * single user while the wizard is open, released on completion/unmount or on TTL expiry.
 * The frontend heartbeats via `renewLocks` well before the TTL elapses, so expiry only hits
 * a session that's genuinely gone idle/offline.
 */

import { TRPCError } from '@trpc/server';

import { getEditLockTtlMs } from '../lib/configManager';

import type { LockEntityType, Prisma, PrismaClient } from '@prisma/client';

type Lock = { expiresAt: Date; lockedByUserId: string };
type LockRef = { entityType: LockEntityType; entityId: string };

/** True when `lock` is still valid (not expired) and held by someone other than `userId`. */
function isLockedByOther(lock: Lock | null, userId: string): boolean {
  return !!lock && lock.expiresAt > new Date() && lock.lockedByUserId !== userId;
}

/**
 * Loads current `EditLock` rows for the given entities in one query (not N) — `entityType_entityId`
 * pairs only need an OR filter, and this runs on a single-connection interactive transaction
 * anyway, so N parallel `findUnique`s wouldn't even overlap on the wire. Shared by `acquireLocks`
 * and `renewLocks`, which differ only in the validation predicate and write op applied after.
 */
function findExistingLocks(tx: Prisma.TransactionClient, entities: LockRef[]) {
  return tx.editLock.findMany({
    where: { OR: entities.map(e => ({ entityType: e.entityType, entityId: e.entityId })) },
  });
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
  entities: LockRef[],
  userId: string,
  prisma: PrismaClient
) {
  // Fired before entering the transaction (independent of it) but only awaited inside, alongside
  // the lock query — the two round-trips overlap instead of running back-to-back.
  const ttlPromise = getEditLockTtlMs(prisma);
  return prisma.$transaction(async tx => {
    const now = new Date();
    const [ttlMs, existingLocks] = await Promise.all([ttlPromise, findExistingLocks(tx, entities)]);
    if (existingLocks.some(lock => isLockedByOther(lock, userId))) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Elemento in modifica da un altro utente' });
    }

    const expiresAt = new Date(now.getTime() + ttlMs);
    return Promise.all(entities.map(e => tx.editLock.upsert({
      where: { entityType_entityId: { entityType: e.entityType, entityId: e.entityId } },
      create: { entityType: e.entityType, entityId: e.entityId, lockedByUserId: userId, lockedAt: now, expiresAt },
      update: { lockedByUserId: userId, lockedAt: now, expiresAt },
    })));
  });
}

/**
 * Heartbeat: extends the TTL on locks already held by `userId`. Called periodically by the
 * frontend (`useWizardLock`) while the wizard is open, well before the current `expiresAt`,
 * so an active session never hits the hard expiry.
 *
 * @throws {TRPCError} CONFLICT if any entity isn't currently locked by `userId` — either the
 * lock genuinely expired before the heartbeat landed, or another user acquired it in between.
 * Either way, this session is no longer valid and the caller should surface it as such.
 */
export async function renewLocks(
  entities: LockRef[],
  userId: string,
  prisma: PrismaClient
) {
  const ttlPromise = getEditLockTtlMs(prisma);
  return prisma.$transaction(async tx => {
    const now = new Date();
    const [ttlMs, existingLocks] = await Promise.all([ttlPromise, findExistingLocks(tx, entities)]);
    const stillOwnedByUser = (e: LockRef) => {
      const lock = existingLocks.find(l => l.entityType === e.entityType && l.entityId === e.entityId);
      return !!lock && lock.expiresAt > now && lock.lockedByUserId === userId;
    };
    if (!entities.every(stillOwnedByUser)) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Sessione scaduta o elemento ripreso da un altro utente' });
    }

    const expiresAt = new Date(now.getTime() + ttlMs);
    return Promise.all(entities.map(e => tx.editLock.update({
      where: { entityType_entityId: { entityType: e.entityType, entityId: e.entityId } },
      data: { expiresAt },
    })));
  });
}

/** Releases locks on one or more entities in a single query — no-op for any the caller doesn't hold. */
export async function releaseLocks(
  entities: LockRef[],
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
