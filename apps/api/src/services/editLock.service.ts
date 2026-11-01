/**
 * Session-scoped edit lock for the planning wizard: a UI-session lock held by a single user
 * while the wizard is open, released on completion/unmount or on TTL expiry.
 * The frontend heartbeats via `renewLocks` well before the TTL elapses, so expiry only hits
 * a session that's genuinely gone idle/offline.
 */

import { TRPCError } from '@trpc/server';

import type { LockEntityType, Prisma, PrismaClient } from '@luke/db';

import { getEditLockTtlMs } from '../lib/configManager';


type LockRef = { entityType: LockEntityType; entityId: string };

/** Without repeats and in one order, so that two transactions never wait on each other's locks. */
function inLockOrder(entities: LockRef[]): LockRef[] {
  const byKey = new Map(entities.map(e => [`${e.entityType}:${e.entityId}`, e]));
  return [...byKey].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, e]) => e);
}

/**
 * Acquires locks on multiple entities atomically — if any is held by another user, none are
 * written. Used by the planning wizard, which needs a `SeasonCalendar` + `CollectionLayout` lock
 * together: acquiring them one at a time could leave one lock held and the other rejected, with
 * no rollback of the first.
 *
 * Each write carries its condition: a write waiting on a concurrent one rechecks it against what
 * that one committed. An insert that meets a committed row writes nothing, and the update after it
 * then decides whose row that is: the caller's, from another tab, or someone else's.
 *
 * @throws {TRPCError} CONFLICT if any entity is currently locked by a different user.
 */
export async function acquireLocks(
  entities: LockRef[],
  userId: string,
  prisma: PrismaClient
) {
  const ttlMs = await getEditLockTtlMs(prisma);
  return prisma.$transaction(async tx => {
    const now = new Date();
    const held = { lockedByUserId: userId, lockedAt: now, expiresAt: new Date(now.getTime() + ttlMs) };
    const locks = [];
    for (const e of inLockOrder(entities)) {
      const take = () => tx.editLock.updateManyAndReturn({
        where: { ...e, OR: [{ lockedByUserId: userId }, { expiresAt: { lte: now } }] },
        data: held,
      });
      let [lock] = await take();
      lock ??= (await tx.editLock.createManyAndReturn({ data: [{ ...e, ...held }], skipDuplicates: true }))[0];
      lock ??= (await take())[0];
      if (!lock) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Elemento in modifica da un altro utente' });
      }
      locks.push(lock);
    }
    return locks;
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
  const ttlMs = await getEditLockTtlMs(prisma);
  return prisma.$transaction(async tx => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    const locks = [];
    for (const e of inLockOrder(entities)) {
      const [lock] = await tx.editLock.updateManyAndReturn({
        where: { ...e, lockedByUserId: userId, expiresAt: { gt: now } },
        data: { expiresAt },
      });
      if (!lock) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Sessione scaduta o elemento ripreso da un altro utente' });
      }
      locks.push(lock);
    }
    return locks;
  });
}

/**
 * Releases locks on one or more entities — no-op for any the caller doesn't hold. One statement per
 * lock, each holding only its own row: a single delete of several could deadlock with an acquire.
 */
export async function releaseLocks(
  entities: LockRef[],
  userId: string,
  prisma: PrismaClient
) {
  for (const e of inLockOrder(entities)) {
    await prisma.editLock.deleteMany({ where: { ...e, lockedByUserId: userId } });
  }
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
  prisma: PrismaClient | Prisma.TransactionClient
) {
  const lock = await prisma.editLock.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
  });
  if (lock && lock.expiresAt > new Date() && lock.lockedByUserId !== userId) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Pianificazione in corso da un altro utente — riprova più tardi',
    });
  }
}
