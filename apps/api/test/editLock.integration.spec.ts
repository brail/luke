/**
 * The planning wizard's session lock (`editLock`). A lock has one holder: acquiring and renewing
 * carry that condition in their writes, so a transaction waiting on another one rechecks it against
 * what that one committed. Each race holds a transaction open at the point it matters
 * (`whileHeld`), and asserts the final state along with the outcome.
 */

import { randomUUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { acquireLocks, releaseLocks, renewLocks } from '../src/services/editLock.service';

import { createCallerWithSession, createTestUser, grantBrandAccess, setupTestDb } from './helpers';
import { createCalendarFixture } from './helpers/calendarFixture';
import { whileHeld } from './helpers/heldTransaction';

import type { Client } from 'pg';

const HOUR_MS = 3_600_000;
const FUTURE = () => new Date(Date.now() + HOUR_MS);
const PAST = () => new Date(Date.now() - HOUR_MS);

let prisma: PrismaClient;
let alice: string;
let bob: string;

const target = (entityId: string = randomUUID()) => ({ entityType: 'COLLECTION_LAYOUT' as const, entityId });

const seedLock = (entityId: string, lockedByUserId: string, expiresAt: Date) =>
  prisma.editLock.create({ data: { ...target(entityId), lockedByUserId, expiresAt } });

const holderOf = async (entityId: string) =>
  (await prisma.editLock.findFirst({ where: { entityId } }))?.lockedByUserId;

/** A held transaction taking the lock for `userId`, whether or not a row is there yet. */
const takeLock = (holder: Client, entityId: string, userId: string) =>
  holder.query(
    `INSERT INTO edit_locks (id, "entityType", "entityId", "lockedByUserId", "expiresAt")
     VALUES ($1, 'COLLECTION_LAYOUT', $2, $3, now() + interval '1 hour')
     ON CONFLICT ("entityType", "entityId")
     DO UPDATE SET "lockedByUserId" = EXCLUDED."lockedByUserId", "expiresAt" = EXCLUDED."expiresAt"`,
    [randomUUID(), entityId, userId]
  );

beforeEach(async () => {
  prisma = await setupTestDb();
  const [a, b] = await Promise.all([createTestUser('editor'), createTestUser('editor')]);
  alice = a.user.id;
  bob = b.user.id;
});

describe('acquireLocks', () => {
  it('takes a free lock and returns it with its expiry', async () => {
    const lock = target();

    const [acquired] = await acquireLocks([lock], alice, prisma);

    expect(acquired).toMatchObject({ ...lock, lockedByUserId: alice });
    expect(acquired!.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('lets the holder acquire again, pushing the expiry out', async () => {
    const lock = target();
    await seedLock(lock.entityId, alice, new Date(Date.now() + 1000));

    const [acquired] = await acquireLocks([lock], alice, prisma);

    expect(acquired!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 1000);
  });

  it('refuses a lock another user holds', async () => {
    const lock = target();
    await seedLock(lock.entityId, alice, FUTURE());

    await expect(acquireLocks([lock], bob, prisma)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await holderOf(lock.entityId)).toBe(alice);
  });

  it('takes over an expired lock', async () => {
    const lock = target();
    await seedLock(lock.entityId, alice, PAST());

    await acquireLocks([lock], bob, prisma);

    expect(await holderOf(lock.entityId)).toBe(bob);
  });

  it('takes all or nothing', async () => {
    const [free, held] = [target(), target()];
    await seedLock(held.entityId, alice, FUTURE());

    await expect(acquireLocks([free, held], bob, prisma)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(acquireLocks([held, free], bob, prisma)).rejects.toMatchObject({ code: 'CONFLICT' });

    expect(await holderOf(free.entityId)).toBeUndefined();
  });

  it('takes a repeated entity once', async () => {
    const lock = target();

    const acquired = await acquireLocks([lock, lock], alice, prisma);

    expect(acquired).toHaveLength(1);
  });
});

describe('renewLocks', () => {
  it('pushes out the expiry of a lock the caller holds', async () => {
    const lock = target();
    await seedLock(lock.entityId, alice, new Date(Date.now() + 1000));

    const [renewed] = await renewLocks([lock], alice, prisma);

    expect(renewed!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 1000);
  });

  it.each([
    ['absent', async () => undefined],
    ['expired', (id: string) => seedLock(id, alice, PAST())],
    ['held by another user', (id: string) => seedLock(id, bob, FUTURE())],
  ])('refuses a lock that is %s', async (_state, seed) => {
    const lock = target();
    await seed(lock.entityId);

    await expect(renewLocks([lock], alice, prisma)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('renews all or nothing', async () => {
    const [own, lost] = [target(), target()];
    const original = new Date(Date.now() + 1000);
    await seedLock(own.entityId, alice, original);

    await expect(renewLocks([own, lost], alice, prisma)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(renewLocks([lost, own], alice, prisma)).rejects.toMatchObject({ code: 'CONFLICT' });

    const stored = await prisma.editLock.findUniqueOrThrow({ where: { entityType_entityId: own } });
    expect(stored.expiresAt).toEqual(original);
  });
});

describe('releaseLocks', () => {
  it('accepts a repeated entity', async () => {
    const lock = target();
    await seedLock(lock.entityId, alice, FUTURE());

    await releaseLocks([lock, lock], alice, prisma);

    expect(await holderOf(lock.entityId)).toBeUndefined();
  });

  it('releases only what the caller holds', async () => {
    const [own, other] = [target(), target()];
    await Promise.all([seedLock(own.entityId, alice, FUTURE()), seedLock(other.entityId, bob, FUTURE())]);

    await releaseLocks([own, other], alice, prisma);

    expect(await holderOf(own.entityId)).toBeUndefined();
    expect(await holderOf(other.entityId)).toBe(bob);
  });
});

describe('races', () => {
  it('acquire waiting on a first acquire of a free lock is refused', async () => {
    const lock = target();

    const outcome = await whileHeld(
      holder => takeLock(holder, lock.entityId, alice),
      () => acquireLocks([lock], bob, prisma)
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } });
    expect(await holderOf(lock.entityId)).toBe(alice);
  });

  it('acquire by the same user waiting on a first acquire succeeds: two tabs, one holder', async () => {
    const lock = target();

    const outcome = await whileHeld(
      holder => takeLock(holder, lock.entityId, alice),
      () => acquireLocks([lock], alice, prisma)
    );

    expect(outcome).toMatchObject({ status: 'fulfilled', value: [{ lockedByUserId: alice }] });
  });

  it('acquire waiting on a takeover of an expired lock is refused', async () => {
    const lock = target();
    const { user } = await createTestUser('editor');
    await seedLock(lock.entityId, user.id, PAST());

    const outcome = await whileHeld(
      holder => takeLock(holder, lock.entityId, alice),
      () => acquireLocks([lock], bob, prisma)
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } });
    expect(await holderOf(lock.entityId)).toBe(alice);
  });

  it('renew waiting on a takeover is refused, and does not extend the new lock', async () => {
    const lock = target();
    await seedLock(lock.entityId, bob, FUTURE());
    const takenUntil = new Date(Date.now() + 2 * HOUR_MS);

    const outcome = await whileHeld(
      holder =>
        holder.query(
          `UPDATE edit_locks SET "lockedByUserId" = $2, "expiresAt" = $3::timestamp WHERE "entityId" = $1`,
          [lock.entityId, alice, takenUntil.toISOString()]
        ),
      () => renewLocks([lock], bob, prisma)
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } });
    const stored = await prisma.editLock.findUniqueOrThrow({ where: { entityType_entityId: lock } });
    expect(stored).toMatchObject({ lockedByUserId: alice, expiresAt: takenUntil });
  });

  it('acquires in one order whatever the request: a reversed request waits on the first entity', async () => {
    const [first, second] = [randomUUID(), randomUUID()].sort();

    // The held transaction takes the first, then the second. In request order the other would hold
    // the second by then and deadlock; in sorted order it waits on the first with nothing written.
    const outcome = await whileHeld(
      holder => takeLock(holder, first!, alice),
      () => acquireLocks([target(second), target(first)], bob, prisma),
      holder => takeLock(holder, second!, alice)
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } });
    expect(await holderOf(first!)).toBe(alice);
    expect(await holderOf(second!)).toBe(alice);
  });
});

describe('editLock router: the target has to be in the caller`s brands', () => {
  async function editorOutside() {
    const fixture = await createCalendarFixture(prisma);
    const { user, session } = await createTestUser('editor');
    return { fixture, user, session, calendar: { entityType: 'SEASON_CALENDAR' as const, entityId: fixture.calendarId } };
  }

  it('refuses acquiring and renewing outside them', async () => {
    const { session, calendar } = await editorOutside();
    const caller = createCallerWithSession(session);

    await expect(caller.editLock.acquireMany({ entities: [calendar] })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(caller.editLock.renew({ entities: [calendar] })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(await holderOf(calendar.entityId)).toBeUndefined();
  });

  it('lets a caller with access, and an admin, acquire, renew and release', async () => {
    const { fixture, user, session, calendar } = await editorOutside();
    await grantBrandAccess(prisma, { brandIds: [fixture.brandId], userIds: [user.id], label: 'Lock' });
    const admin = await createTestUser('admin');

    for (const current of [session, admin.session]) {
      const locks = createCallerWithSession(current).editLock;
      await expect(locks.acquireMany({ entities: [calendar] })).resolves.toHaveLength(1);
      await expect(locks.renew({ entities: [calendar] })).resolves.toHaveLength(1);
      await expect(locks.release({ entities: [calendar] })).resolves.toEqual({ success: true });
    }
  });

  it('refuses a target that does not exist, writing nothing', async () => {
    const admin = await createTestUser('admin');
    const fixture = await createCalendarFixture(prisma);
    const entities = [
      { entityType: 'SEASON_CALENDAR' as const, entityId: fixture.calendarId },
      target(),
    ];

    await expect(
      createCallerWithSession(admin.session).editLock.acquireMany({ entities })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(await holderOf(fixture.calendarId)).toBeUndefined();
  });
});
