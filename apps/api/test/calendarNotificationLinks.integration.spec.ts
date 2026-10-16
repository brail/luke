/**
 * Where a calendar notification link points (`calendarLink`) and what it opens
 * (`seasonCalendar.locate`): a change links to its event, a grouped one to its calendar, one with
 * neither to the page; `locate` finds an event only where `listMilestones` would list it, and answers
 * NOT_FOUND alike for missing, out-of-scope and hidden, so a link reveals nothing more.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { flushAllCalendarNotifications, notifyCalendarChange } from '../src/lib/notifications';

import {
  createCalendarFixture,
  createCallerWithSession,
  createSilentLogger,
  createTestUser,
  grantBrandAccess,
  setupTestDb,
  type CalendarFixture,
} from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let mine: CalendarFixture;
let other: CalendarFixture;
let editor: UserSession;
let viewer: UserSession;
let admin: UserSession;
/** Visible to the editor's function, to nobody's in particular, and to another function only. */
let sharedId: string;
let openId: string;
let hiddenId: string;

beforeAll(async () => {
  prisma = await setupTestDb();
  [mine, other] = await Promise.all([createCalendarFixture(prisma, { prefix: 'LKM' }), createCalendarFixture(prisma, { prefix: 'LKO' })]);
  const [e, v, a] = await Promise.all([createTestUser('editor'), createTestUser('viewer'), createTestUser('admin')]);
  [editor, viewer, admin] = [e.session, v.session, a.session];
  const { functionId } = await grantBrandAccess(prisma, { brandIds: [mine.brandId], userIds: [e.user.id, v.user.id], label: 'Links' });
  const elsewhere = await prisma.companyFunction.create({ data: { slug: `links_other_${mine.uid.toLowerCase()}`, name: `Links other ${mine.uid}`, order: 91, isActive: true } });

  const event = (title: string, functionIds: string[], calendar = mine) => prisma.calendarEvent.create({
    data: {
      calendarId: calendar.calendarId, planningGroupId: calendar.planningGroupId, title, allDay: true,
      startAt: new Date('2099-10-16T00:00:00.000Z'),
      visibilities: { create: functionIds.map(id => ({ functionId: id })) },
    },
  });
  [sharedId, openId, hiddenId] = (await Promise.all([event('Condiviso', [functionId]), event('Aperto', []), event('Nascosto', [elsewhere.id])])).map(x => x.id);
});

describe('seasonCalendar.locate', () => {
  it('finds an event the caller can list, with its calendar and its brand · season', async () => {
    const located = await createCallerWithSession(editor).seasonCalendar.locate({ eventId: sharedId });
    expect(located).toMatchObject({
      brandId: mine.brandId,
      seasonId: mine.seasonId,
      label: `LKM Brand ${mine.uid} · LKM Season ${mine.uid}`,
      event: { id: sharedId, title: 'Condiviso', allDay: true },
    });
    expect((await createCallerWithSession(editor).seasonCalendar.locate({ eventId: openId })).event?.id).toBe(openId);
  });

  it('answers NOT_FOUND alike for a missing event, one of another brand and one hidden from the caller', async () => {
    const outside = await prisma.calendarEvent.create({
      data: { calendarId: other.calendarId, planningGroupId: other.planningGroupId, title: 'Altrove', allDay: true, startAt: new Date('2099-10-16T00:00:00.000Z') },
    });
    const caller = createCallerWithSession(editor);
    for (const eventId of [randomUUID(), outside.id, hiddenId]) {
      await expect(caller.seasonCalendar.locate({ eventId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
    // The admin sees every function's events, as in the list.
    expect((await createCallerWithSession(admin).seasonCalendar.locate({ eventId: hiddenId })).event?.id).toBe(hiddenId);
  });

  it('answers NOT_FOUND for a retired season, which the context cannot be switched to', async () => {
    const retired = await createCalendarFixture(prisma, { prefix: 'LKR' });
    await prisma.season.update({ where: { id: retired.seasonId }, data: { isActive: false } });
    const past = await prisma.calendarEvent.create({
      data: { calendarId: retired.calendarId, planningGroupId: retired.planningGroupId, title: 'Passato', allDay: true, startAt: new Date('2099-10-16T00:00:00.000Z') },
    });
    await expect(createCallerWithSession(admin).seasonCalendar.locate({ eventId: past.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(createCallerWithSession(admin).seasonCalendar.locate({ calendarId: retired.calendarId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('finds a calendar of a brand the caller has, and only that', async () => {
    const caller = createCallerWithSession(editor);
    expect(await caller.seasonCalendar.locate({ calendarId: mine.calendarId })).toMatchObject({ brandId: mine.brandId, event: null });
    await expect(caller.seasonCalendar.locate({ calendarId: other.calendarId })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('is open to a reader', async () => {
    expect((await createCallerWithSession(viewer).seasonCalendar.locate({ eventId: sharedId })).event?.id).toBe(sharedId);
  });
});

describe('calendar change links', () => {
  it('open the event, the calendar of a grouped change, or the page when there is neither', async () => {
    const recipient = (await createTestUser('viewer')).user.id;
    const [one, many, spanning] = await Promise.all([createTestUser('admin'), createTestUser('admin'), createTestUser('admin')]);
    const change = (actorId: string, target: { eventId?: string; calendarId?: string }) =>
      notifyCalendarChange(prisma, { preloadedUserIds: [recipient], actorId, titleSuffix: 'ha modificato un evento', message: 'm', ...target });

    await change(one.user.id, { eventId: sharedId, calendarId: mine.calendarId });
    await change(many.user.id, { eventId: sharedId, calendarId: mine.calendarId });
    await change(many.user.id, { eventId: openId, calendarId: mine.calendarId });
    // A bulk delete across calendars names neither.
    await change(spanning.user.id, {});
    await flushAllCalendarNotifications(prisma, createSilentLogger());

    const links = (await prisma.notification.findMany({ where: { userId: recipient }, select: { link: true } })).map(n => n.link).sort();
    expect(links).toEqual(['/calendar', `/calendar?calendar=${mine.calendarId}`, `/calendar?event=${sharedId}`].sort());
  });
});
