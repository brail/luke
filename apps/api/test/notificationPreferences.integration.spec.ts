/**
 * One preference rule for every CALENDAR sender (`receives`): the category is the master switch and a
 * key switched off mutes that kind too; the switches the user sees report exactly that.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createNotification, flushAllCalendarNotifications, notifyCalendarChange } from '../src/lib/notifications';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';
import { createSilentLogger } from './helpers/logger';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = await setupTestDb();
});

describe('notifications.preferences.listCalendarEventOverrides', () => {
  it('shows every kind off while the category is off, and a kind switched off as off', async () => {
    const { session } = await createTestUser('viewer');
    const caller = createCallerWithSession(session);
    const enabled = async () =>
      Object.fromEntries((await caller.notifications.preferences.listCalendarEventOverrides()).map(o => [o.eventKey, o.enabled]));

    await caller.notifications.preferences.updateCalendarEventOverride({ eventKey: 'CALENDAR_DEADLINE_OVERDUE', enabled: false });
    expect(await enabled()).toMatchObject({ CALENDAR_DEADLINE_OVERDUE: false, CALENDAR_DIGEST: true, CALENDAR_CREATE: true });

    // A kind switched back on does not outlive the master switch.
    await caller.notifications.preferences.updateCalendarEventOverride({ eventKey: 'CALENDAR_DIGEST', enabled: true });
    await caller.notifications.preferences.update({ category: 'CALENDAR', enabled: false });
    expect(await enabled()).toMatchObject({ CALENDAR_DEADLINE_OVERDUE: false, CALENDAR_DIGEST: false, CALENDAR_CREATE: false });
  });
});

describe('a muted key wins over an enabled category, for every sender', () => {
  /** A user with the CALENDAR category on and `CALENDAR_UPDATE` off. */
  async function mutedOnUpdate() {
    const { user } = await createTestUser('viewer');
    await prisma.notificationPreference.createMany({
      data: [
        { userId: user.id, category: 'CALENDAR', eventKey: '', enabled: true },
        { userId: user.id, category: 'CALENDAR', eventKey: 'CALENDAR_UPDATE', enabled: false },
      ],
    });
    return user.id;
  }
  const countFor = (userId: string) => prisma.notification.count({ where: { userId } });

  it('a single notification and a buffered change both skip the muted user', async () => {
    const [muted, other, actor] = [await mutedOnUpdate(), (await createTestUser('viewer')).user.id, (await createTestUser('admin')).user.id];

    await createNotification(prisma, { userId: muted, category: 'CALENDAR', eventKey: 'CALENDAR_UPDATE', title: 't', message: 'm' });
    await notifyCalendarChange(prisma, { preloadedUserIds: [muted, other], actorId: actor, titleSuffix: 'ha modificato un evento', message: 'm', eventKey: 'CALENDAR_UPDATE' });
    await flushAllCalendarNotifications(prisma, createSilentLogger());

    expect(await countFor(muted)).toBe(0);
    expect(await countFor(other)).toBe(1);
  });
});

describe('grouped calendar changes', () => {
  const viewer = async () => (await createTestUser('viewer')).user.id;
  const mute = (userId: string, ...eventKeys: string[]) =>
    prisma.notificationPreference.createMany({ data: eventKeys.map(eventKey => ({ userId, category: 'CALENDAR' as const, eventKey, enabled: false })) });
  const change = (actorId: string, userIds: string[], eventKey: 'CALENDAR_CREATE' | 'CALENDAR_UPDATE') =>
    notifyCalendarChange(prisma, {
      preloadedUserIds: userIds, actorId, message: 'm', eventKey,
      titleSuffix: eventKey === 'CALENDAR_CREATE' ? 'ha creato un evento' : 'ha modificato un evento',
    });
  const titlesOf = async (userId: string) =>
    (await prisma.notification.findMany({ where: { userId }, select: { title: true } })).map(n => n.title);

  it('tell each recipient of the changes they did not mute, one by its own text, and nothing when they muted them all', async () => {
    const [all, oneMuted, bothMuted, actor] = [await viewer(), await viewer(), await viewer(), (await createTestUser('admin')).user];
    await mute(oneMuted, 'CALENDAR_UPDATE');
    await mute(bothMuted, 'CALENDAR_UPDATE', 'CALENDAR_CREATE');

    await change(actor.id, [all, oneMuted, bothMuted], 'CALENDAR_UPDATE');
    await change(actor.id, [all, oneMuted, bothMuted], 'CALENDAR_CREATE');
    await flushAllCalendarNotifications(prisma, createSilentLogger());

    expect(await titlesOf(all)).toEqual([expect.stringMatching(/ha modificato 2 eventi$/)]);
    expect(await titlesOf(oneMuted)).toEqual([expect.stringMatching(/ha creato un evento$/)]);
    expect(await titlesOf(bothMuted)).toEqual([]);
  });

  it('join one entry when two first calls for the same actor and calendar arrive together', async () => {
    const [recipient, actor] = [await viewer(), (await createTestUser('admin')).user];
    await Promise.all([change(actor.id, [recipient], 'CALENDAR_UPDATE'), change(actor.id, [recipient], 'CALENDAR_CREATE')]);
    await flushAllCalendarNotifications(prisma, createSilentLogger());

    expect(await titlesOf(recipient)).toEqual([expect.stringMatching(/ha modificato 2 eventi$/)]);
  });

  it('follow the category alone for a change without a type', async () => {
    const [categoryOff, categoryOn, actor] = [await viewer(), await viewer(), (await createTestUser('admin')).user];
    await mute(categoryOff, '');
    await notifyCalendarChange(prisma, { preloadedUserIds: [categoryOff, categoryOn], actorId: actor.id, titleSuffix: 'ha modificato un evento', message: 'm' });
    await flushAllCalendarNotifications(prisma, createSilentLogger());

    expect(await titlesOf(categoryOff)).toEqual([]);
    expect(await titlesOf(categoryOn)).toEqual([expect.stringMatching(/ha modificato un evento$/)]);
  });
});
