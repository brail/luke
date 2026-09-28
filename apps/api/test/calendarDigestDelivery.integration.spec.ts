/**
 * The digest delivery contract: each recipient's email is due from 07:00 in their own zone and
 * covers their own "yesterday"; a `CalendarDigestDelivery` row per (user, local date, calendar)
 * makes each state change one conditional statement, so racing ticks send once, a failure is
 * retried after its backoff at most three times, and what can no longer be sent is abandoned —
 * never a live claim. The sender and the clock are injected: no SMTP, and times are fixed.
 *
 * Every scenario lives in one random far-future year, so no other spec's audit rows fall in its
 * windows, and uses its own calendar and recipient.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  addCalendarDays,
  instantAt,
  parseCalendarDate,
  startOfDayIn,
  utcMidnightOf,
  type CalendarDate,
} from '@luke/core';
import type { Prisma, PrismaClient } from '@luke/db';

import {
  buildDigestTasks,
  runDigestNow,
  runDigestTick,
  type DigestTickDeps,
  type EmailTask,
} from '../src/lib/calendarDigestScheduler';
import * as audience from '../src/services/calendarAudience.service';

import {
  createCalendarFixture,
  createCallerWithSession,
  createSilentLogger,
  createTestUser,
  grantBrandAccess,
  setupTestDb,
} from './helpers';

let prisma: PrismaClient;
const log = createSilentLogger();
const ROME = 'Europe/Rome';
const YEAR = 2040 + Math.floor(Math.random() * 50);
const createdUserIds: string[] = [];

beforeAll(async () => {
  prisma = await setupTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  // The year's rows too: global ticks also record deliveries for other recipients in that year.
  await prisma.calendarDigestDelivery.deleteMany({
    where: { OR: [{ userId: { in: createdUserIds } }, { localDate: { gte: new Date(Date.UTC(YEAR, 0, 1)), lt: new Date(Date.UTC(YEAR + 1, 0, 1)) } }] },
  });
});

function date(value: string): CalendarDate {
  const parsed = parseCalendarDate(value);
  if (!parsed) throw new Error(`not a calendar date: ${value}`);
  return parsed;
}

function day(monthDay: string): CalendarDate {
  return date(`${YEAR}-${monthDay}`);
}

function plusMinutes(instant: Date, minutes: number): Date {
  return new Date(instant.getTime() + minutes * 60_000);
}

interface Recipient {
  userId: string;
  calendarId: string;
  session: Awaited<ReturnType<typeof createTestUser>>['session'];
  planningGroupId: string;
  functionId: string;
}

/** A calendar and a recipient on its brand team, reading in `timeZone`. */
async function recipient(timeZone: string): Promise<Recipient> {
  const fixture = await createCalendarFixture(prisma, { prefix: 'DGD' });
  const { user, session } = await createTestUser('editor');
  createdUserIds.push(user.id);
  await prisma.user.update({ where: { id: user.id }, data: { timezone: timeZone } });
  const { functionId } = await grantBrandAccess(prisma, { brandIds: [fixture.brandId], userIds: [user.id], label: 'Digest delivery' });
  return { userId: user.id, calendarId: fixture.calendarId, session, planningGroupId: fixture.planningGroupId, functionId };
}

/** Creates an event on the recipient's calendar and dates its audit row `changedAt`. */
async function change(to: Recipient, changedAt: Date): Promise<string> {
  const event = await createCallerWithSession(to.session).seasonCalendar.createMilestone({
    planningGroupId: to.planningGroupId,
    title: `Delivery ${changedAt.toISOString()}`,
    startAt: changedAt.toISOString(),
    allDay: false,
    publishExternally: false,
    visibilityFunctionIds: [to.functionId],
  });
  await prisma.auditLog.updateMany({ where: { targetId: event.id }, data: { createdAt: changedAt } });
  return event.id;
}

async function recipientWithChange(timeZone: string, changedAt: Date): Promise<Recipient> {
  const to = await recipient(timeZone);
  await change(to, changedAt);
  return to;
}

/** A sender that records what it sends, and throws for the tasks `fails` picks. */
function recorder(fails: (task: EmailTask) => boolean = () => false) {
  const sent: EmailTask[] = [];
  const send = async (task: EmailTask) => {
    if (fails(task)) throw new Error('SMTP down');
    sent.push(task);
  };
  return { sent, send };
}

function deps(at: Date | (() => Date), send: DigestTickDeps['send'], smtpReady = true): DigestTickDeps {
  return { clock: typeof at === 'function' ? at : () => at, send, smtpReady: async () => smtpReady };
}

function sentTo(sent: EmailTask[], to: Recipient): EmailTask[] {
  return sent.filter(task => task.userId === to.userId && task.calendarId === to.calendarId);
}

function rowOf(to: Recipient) {
  return prisma.calendarDigestDelivery.findFirstOrThrow({ where: { userId: to.userId, calendarId: to.calendarId } });
}

/** A delivery row as a tick of `localDate` in Rome would have stored it, with `overrides`. */
function romeRow(to: Recipient, localDate: CalendarDate, overrides: Partial<Prisma.CalendarDigestDeliveryUncheckedCreateInput>) {
  return prisma.calendarDigestDelivery.create({
    data: {
      userId: to.userId,
      calendarId: to.calendarId,
      localDate: utcMidnightOf(localDate),
      timeZone: ROME,
      windowStart: startOfDayIn(addCalendarDays(localDate, -1), ROME),
      windowEnd: startOfDayIn(localDate, ROME),
      expiresAt: startOfDayIn(addCalendarDays(localDate, 1), ROME),
      status: 'FAILED',
      attempts: 1,
      claimToken: 'someone-else',
      leaseUntil: startOfDayIn(localDate, ROME),
      ...overrides,
    },
  });
}

describe('first sends', () => {
  it('sends each email once, even to two ticks racing, and stores the unit it sent', async () => {
    const d = day('03-11');
    const to = await recipientWithChange(ROME, instantAt(addCalendarDays(d, -1), '11:00', ROME));
    const { sent, send } = recorder();
    const at = instantAt(d, '07:30', ROME);

    await Promise.all([runDigestTick(prisma, log, deps(at, send)), runDigestTick(prisma, log, deps(at, send))]);
    await runDigestTick(prisma, log, deps(instantAt(d, '18:00', ROME), send));

    expect(sentTo(sent, to)).toHaveLength(1);
    expect(await rowOf(to)).toMatchObject({
      status: 'SENT',
      attempts: 1,
      localDate: utcMidnightOf(d),
      timeZone: ROME,
      windowStart: startOfDayIn(addCalendarDays(d, -1), ROME),
      windowEnd: startOfDayIn(d, ROME),
      expiresAt: startOfDayIn(addCalendarDays(d, 1), ROME),
    });
  });

  it("is due from 07:00 in each recipient's own zone, covering their own yesterday", async () => {
    // 20:00 on May 10 in Shanghai, 05:00 on May 10 in Los Angeles.
    const changedAt = new Date(`${YEAR}-05-10T12:00:00.000Z`);
    const shanghai = await recipientWithChange('Asia/Shanghai', changedAt);
    const losAngeles = await recipientWithChange('America/Los_Angeles', changedAt);
    const may11 = day('05-11');
    const { sent, send } = recorder();

    await runDigestTick(prisma, log, deps(instantAt(may11, '06:59', 'Asia/Shanghai'), send));
    expect(sentTo(sent, shanghai)).toHaveLength(0);

    await runDigestTick(prisma, log, deps(instantAt(may11, '07:00', 'Asia/Shanghai'), send));
    expect(sentTo(sent, shanghai)).toHaveLength(1);
    // Still May 10 in Los Angeles: its yesterday is May 9, which has no change.
    expect(sentTo(sent, losAngeles)).toHaveLength(0);

    await runDigestTick(prisma, log, deps(instantAt(may11, '07:00', 'America/Los_Angeles'), send));
    expect(sentTo(sent, losAngeles)).toHaveLength(1);
  });

  it('covers a 25-hour yesterday after the autumn clock change', async () => {
    const lastOfOctober = new Date(Date.UTC(YEAR, 9, 31));
    const sunday = date(new Date(Date.UTC(YEAR, 9, 31 - lastOfOctober.getUTCDay())).toISOString().slice(0, 10));
    const to = await recipientWithChange(ROME, instantAt(sunday, '23:30', ROME));
    const { sent, send } = recorder();

    await runDigestTick(prisma, log, deps(instantAt(addCalendarDays(sunday, 1), '07:15', ROME), send));

    expect(sentTo(sent, to)).toHaveLength(1);
    const row = await rowOf(to);
    expect(row.windowEnd.getTime() - row.windowStart.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it('leases a first claim from the time it is made, not from when the tick started', async () => {
    const d = day('07-12');
    const to = await recipientWithChange(ROME, instantAt(addCalendarDays(d, -1), '10:00', ROME));
    const { send } = recorder();
    const started = instantAt(d, '07:10', ROME);
    const claimedAt = instantAt(d, '07:40', ROME);
    let reads = 0;

    await runDigestTick(prisma, log, deps(() => (reads++ === 0 ? started : claimedAt), send));

    expect((await rowOf(to)).leaseUntil).toEqual(plusMinutes(claimedAt, 60));
  });

  it('never claims once the send day is over, even in a tick that started before', async () => {
    const d = day('07-11');
    const to = await recipientWithChange(ROME, instantAt(addCalendarDays(d, -1), '10:00', ROME));
    const { sent, send } = recorder();
    const started = instantAt(d, '23:59', ROME);
    const nextDay = startOfDayIn(addCalendarDays(d, 1), ROME);
    let reads = 0;

    await runDigestTick(prisma, log, deps(() => (reads++ === 0 ? started : nextDay), send));

    expect(sentTo(sent, to)).toHaveLength(0);
    expect(await prisma.calendarDigestDelivery.count({ where: { userId: to.userId } })).toBe(0);
  });

  it('sends nothing more for a local date already recorded, after a change of zone', async () => {
    const d = day('09-11');
    const to = await recipientWithChange(ROME, instantAt(addCalendarDays(d, -1), '10:00', ROME));
    const { sent, send } = recorder();
    await runDigestTick(prisma, log, deps(instantAt(d, '07:30', ROME), send));

    await prisma.user.update({ where: { id: to.userId }, data: { timezone: 'Europe/London' } });
    await runDigestTick(prisma, log, deps(instantAt(d, '09:00', 'Europe/London'), send));

    expect(sentTo(sent, to)).toHaveLength(1);
  });

  it('without SMTP, abandons what is over but claims nothing', async () => {
    const d = day('09-21');
    const to = await recipientWithChange(ROME, instantAt(addCalendarDays(d, -1), '10:00', ROME));
    const exhausted = await romeRow(to, addCalendarDays(d, -3), { attempts: 3 });
    const { sent, send } = recorder();

    await runDigestTick(prisma, log, deps(instantAt(d, '07:30', ROME), send, false));

    expect((await prisma.calendarDigestDelivery.findUniqueOrThrow({ where: { id: exhausted.id } })).status).toBe('ABANDONED');
    expect(await prisma.calendarDigestDelivery.count({ where: { userId: to.userId, localDate: utcMidnightOf(d) } })).toBe(0);
    expect(sentTo(sent, to)).toHaveLength(0);
  });
});

describe('retries and abandonment', () => {
  it('retries a failed email after its backoff, then never again', async () => {
    const d = day('06-11');
    const to = await recipientWithChange(ROME, instantAt(addCalendarDays(d, -1), '10:00', ROME));
    let smtpDown = true;
    const { sent, send } = recorder(task => task.userId === to.userId && smtpDown);
    const t0 = instantAt(d, '07:10', ROME);

    await runDigestTick(prisma, log, deps(t0, send));
    expect(await rowOf(to)).toMatchObject({ status: 'FAILED', attempts: 1 });

    smtpDown = false;
    await runDigestTick(prisma, log, deps(plusMinutes(t0, 15), send));
    expect(await rowOf(to)).toMatchObject({ status: 'FAILED', attempts: 1 });

    await runDigestTick(prisma, log, deps(plusMinutes(t0, 31), send));
    expect(await rowOf(to)).toMatchObject({ status: 'SENT', attempts: 2 });

    await runDigestTick(prisma, log, deps(plusMinutes(t0, 120), send));
    expect(sentTo(sent, to)).toHaveLength(1);
  });

  it('abandons an email after three failed attempts, and says so', async () => {
    const d = day('06-12');
    const to = await recipientWithChange(ROME, instantAt(addCalendarDays(d, -1), '10:00', ROME));
    const { send } = recorder(task => task.userId === to.userId);
    const warn = vi.spyOn(log, 'warn');
    const t0 = instantAt(d, '07:10', ROME);

    // Backoff: 30 min after the first failure, 60 after the second.
    await runDigestTick(prisma, log, deps(t0, send));
    await runDigestTick(prisma, log, deps(plusMinutes(t0, 31), send));
    await runDigestTick(prisma, log, deps(plusMinutes(t0, 31 + 45), send));
    expect(await rowOf(to)).toMatchObject({ status: 'FAILED', attempts: 2 });
    await runDigestTick(prisma, log, deps(plusMinutes(t0, 31 + 61), send));
    expect(await rowOf(to)).toMatchObject({ status: 'FAILED', attempts: 3 });

    await runDigestTick(prisma, log, deps(plusMinutes(t0, 31 + 61 + 15), send));
    expect((await rowOf(to)).status).toBe('ABANDONED');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ abandoned: expect.any(Number) }), expect.stringContaining('abandoned'));
  });

  it('never abandons a live claim, even with its attempts spent', async () => {
    const d = day('08-11');
    const to = await recipientWithChange(ROME, instantAt(addCalendarDays(d, -1), '10:00', ROME));
    const t0 = instantAt(d, '07:10', ROME);
    await romeRow(to, d, { status: 'SENDING', attempts: 3, leaseUntil: plusMinutes(t0, 30) });
    const { sent, send } = recorder();

    await runDigestTick(prisma, log, deps(t0, send));
    expect((await rowOf(to)).status).toBe('SENDING');

    await runDigestTick(prisma, log, deps(plusMinutes(t0, 31), send));
    expect((await rowOf(to)).status).toBe('ABANDONED');
    expect(sentTo(sent, to)).toHaveLength(0);
  });

  it('abandons a failed email as soon as its send day ends, without waiting for its backoff', async () => {
    const d = day('08-13');
    const to = await recipient(ROME);
    const nextDay = startOfDayIn(addCalendarDays(d, 1), ROME);
    await romeRow(to, d, { status: 'FAILED', attempts: 1, leaseUntil: plusMinutes(nextDay, 50) });

    await runDigestTick(prisma, log, deps(plusMinutes(nextDay, 5), recorder().send));

    expect((await rowOf(to)).status).toBe('ABANDONED');
  });

  it.each([
    ['success', async () => undefined],
    ['failure', async () => { throw new Error('SMTP down'); }],
  ])('records nothing for an owner whose claim was taken over while it was sending (%s)', async (_outcome, finish) => {
    const d = day('08-14');
    const to = await recipientWithChange(ROME, instantAt(addCalendarDays(d, -1), '10:00', ROME));
    const send = async (task: EmailTask) => {
      if (task.userId !== to.userId) return;
      // What a later tick does once this claim's lease has expired: a new claim, still SENDING.
      await prisma.calendarDigestDelivery.updateMany({ where: { userId: to.userId }, data: { claimToken: 'new-owner', attempts: 2 } });
      await finish();
    };

    await runDigestTick(prisma, log, deps(instantAt(d, '07:10', ROME), send));

    expect(await rowOf(to)).toMatchObject({ status: 'SENDING', claimToken: 'new-owner', attempts: 2, sentAt: null, lastError: null });
  });

  it('lets exactly one of two racing ticks re-claim a failed email', async () => {
    const d = day('08-15');
    const to = await recipientWithChange(ROME, instantAt(addCalendarDays(d, -1), '10:00', ROME));
    const t0 = instantAt(d, '07:10', ROME);
    await romeRow(to, d, { status: 'FAILED', attempts: 1, leaseUntil: plusMinutes(t0, -1) });
    const { sent, send } = recorder();

    await Promise.all([runDigestTick(prisma, log, deps(t0, send)), runDigestTick(prisma, log, deps(t0, send))]);

    expect(sentTo(sent, to)).toHaveLength(1);
    expect(await rowOf(to)).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('does not record SENT over a claim abandoned while its email was going out', async () => {
    const d = day('08-12');
    const to = await recipientWithChange(ROME, instantAt(addCalendarDays(d, -1), '10:00', ROME));
    const send = async (task: EmailTask) => {
      if (task.userId !== to.userId) return;
      // What another instance's sweep would do once this claim's lease had expired.
      await prisma.calendarDigestDelivery.updateMany({ where: { userId: to.userId }, data: { status: 'ABANDONED' } });
    };

    await runDigestTick(prisma, log, deps(instantAt(d, '07:10', ROME), send));

    expect((await rowOf(to)).status).toBe('ABANDONED');
  });

  it('leaves a delivery untouched when its rebuild fails', async () => {
    const d = day('08-21');
    const to = await recipientWithChange(ROME, instantAt(addCalendarDays(d, -1), '10:00', ROME));
    const t0 = instantAt(d, '07:10', ROME);
    // A stored zone that can no longer be used makes the rebuild throw.
    const row = await romeRow(to, d, { timeZone: 'Mars/Olympus', leaseUntil: plusMinutes(t0, -1) });
    const { sent, send } = recorder();

    try {
      await runDigestTick(prisma, log, deps(t0, send));
      expect(await rowOf(to)).toMatchObject({ status: 'FAILED', attempts: 1, timeZone: 'Mars/Olympus', claimToken: 'someone-else' });
      expect(sentTo(sent, to)).toHaveLength(0);
    } finally {
      await prisma.calendarDigestDelivery.delete({ where: { id: row.id } });
    }
  });

  it('leaves a delivery untouched when the audience cannot be read — never taken for "no longer produced"', async () => {
    const d = day('08-22');
    const to = await recipientWithChange(ROME, instantAt(addCalendarDays(d, -1), '10:00', ROME));
    const t0 = instantAt(d, '07:10', ROME);
    const row = await romeRow(to, d, { leaseUntil: plusMinutes(t0, -1) });
    vi.spyOn(audience, 'resolveEventAudience').mockRejectedValue(new Error('database unavailable'));
    const { sent, send } = recorder();

    await runDigestTick(prisma, log, deps(t0, send));

    expect(await prisma.calendarDigestDelivery.findUniqueOrThrow({ where: { id: row.id } }))
      .toMatchObject({ status: 'FAILED', attempts: 1, claimToken: 'someone-else' });
    expect(sentTo(sent, to)).toHaveLength(0);
  });

  it('abandons a failed email whose recipient has opted out since', async () => {
    const d = day('10-11');
    const to = await recipientWithChange(ROME, instantAt(addCalendarDays(d, -1), '10:00', ROME));
    let smtpDown = true;
    const { sent, send } = recorder(task => task.userId === to.userId && smtpDown);
    const t0 = instantAt(d, '07:10', ROME);
    await runDigestTick(prisma, log, deps(t0, send));
    expect((await rowOf(to)).status).toBe('FAILED');

    smtpDown = false;
    await prisma.notificationPreference.create({
      data: { userId: to.userId, category: 'CALENDAR', eventKey: '', enabled: false },
    });
    await runDigestTick(prisma, log, deps(plusMinutes(t0, 31), send));

    expect((await rowOf(to)).status).toBe('ABANDONED');
    expect(sentTo(sent, to)).toHaveLength(0);
  });
});

describe('manual run', () => {
  it("reads the range in the caller's zone and records no delivery", async () => {
    // 23:00 on Oct 1 in Los Angeles, 08:00 on Oct 2 in Rome.
    const changedAt = new Date(`${YEAR}-10-02T06:00:00.000Z`);
    const losAngeles = await recipientWithChange('America/Los_Angeles', changedAt);
    const rome = await recipientWithChange(ROME, changedAt);
    const oct1 = day('10-01');
    const { sent, send } = recorder();

    await runDigestNow(prisma, log, { from: oct1, to: oct1 }, losAngeles.userId, send);
    await runDigestNow(prisma, log, { from: oct1, to: oct1 }, rome.userId, send);

    expect(sentTo(sent, losAngeles).map(task => task.subject)).toEqual([expect.stringContaining(`1 ottobre ${YEAR}`)]);
    expect(sentTo(sent, rome)).toHaveLength(0);
    expect(await prisma.calendarDigestDelivery.count({ where: { userId: { in: [losAngeles.userId, rome.userId] } } })).toBe(0);
  });
});

describe('labels', () => {
  it('writes an all-day move as its calendar dates for a reader west of UTC', async () => {
    const to = await recipient('America/Los_Angeles');
    const caller = createCallerWithSession(to.session);
    const event = await caller.seasonCalendar.createMilestone({
      planningGroupId: to.planningGroupId,
      title: 'All-day move',
      startAt: `${YEAR}-11-05T00:00:00.000Z`,
      allDay: true,
      publishExternally: false,
      visibilityFunctionIds: [to.functionId],
    });
    await caller.seasonCalendar.updateMilestone({ id: event.id, data: { startAt: `${YEAR}-11-07T00:00:00.000Z` } });

    const movedAt = new Date(`${YEAR}-11-02T18:00:00.000Z`);
    await prisma.auditLog.updateMany({ where: { targetId: event.id, action: 'CALENDAR_EVENT_CREATE' }, data: { createdAt: plusMinutes(movedAt, -3 * 24 * 60) } });
    await prisma.auditLog.updateMany({ where: { targetId: event.id, action: 'CALENDAR_EVENT_UPDATE' }, data: { createdAt: movedAt } });

    const { tasks } = await buildDigestTasks(prisma, log, {
      range: { start: plusMinutes(movedAt, -1), end: plusMinutes(movedAt, 1) },
      timeZone: 'America/Los_Angeles',
      include: userId => userId === to.userId,
    });

    const text = tasks.find(task => task.userId === to.userId)?.text ?? '';
    expect(text).toContain('Posticipato: 5 nov → 7 nov');
    expect(text).toContain('Orari in America/Los_Angeles');
  });

  it('reports a timed end moved within the same day, with its times', async () => {
    const to = await recipient(ROME);
    const caller = createCallerWithSession(to.session);
    const event = await caller.seasonCalendar.createMilestone({
      planningGroupId: to.planningGroupId,
      title: 'Timed end move',
      startAt: `${YEAR}-11-12T09:00:00.000Z`,
      endAt: `${YEAR}-11-12T10:00:00.000Z`,
      allDay: false,
      publishExternally: false,
      visibilityFunctionIds: [to.functionId],
    });
    await caller.seasonCalendar.updateMilestone({ id: event.id, data: { endAt: `${YEAR}-11-12T11:00:00.000Z` } });

    const movedAt = new Date(`${YEAR}-11-10T18:00:00.000Z`);
    await prisma.auditLog.updateMany({ where: { targetId: event.id, action: 'CALENDAR_EVENT_CREATE' }, data: { createdAt: plusMinutes(movedAt, -3 * 24 * 60) } });
    await prisma.auditLog.updateMany({ where: { targetId: event.id, action: 'CALENDAR_EVENT_UPDATE' }, data: { createdAt: movedAt } });

    const { tasks } = await buildDigestTasks(prisma, log, {
      range: { start: plusMinutes(movedAt, -1), end: plusMinutes(movedAt, 1) },
      timeZone: ROME,
      include: userId => userId === to.userId,
    });

    expect(tasks.find(task => task.userId === to.userId)?.text ?? '').toContain('Durata modificata: fine 12 nov, 11:00 → 12 nov, 12:00');
  });

  it('treats a malformed date in audit metadata as missing instead of failing the digest', async () => {
    const to = await recipient(ROME);
    const deletedAt = new Date(`${YEAR}-11-20T18:00:00.000Z`);
    await prisma.auditLog.create({
      data: {
        actorId: to.userId,
        action: 'CALENDAR_MILESTONE_DELETE',
        targetType: 'CalendarMilestone',
        targetId: `malformed-${YEAR}-${to.userId}`,
        result: 'SUCCESS',
        createdAt: deletedAt,
        metadata: { title: 'Malformed date', calendarId: to.calendarId, visibleUserIds: [to.userId], startAt: 'not-a-date', endAt: null, allDay: true },
      },
    });

    const { tasks } = await buildDigestTasks(prisma, log, {
      range: { start: plusMinutes(deletedAt, -1), end: plusMinutes(deletedAt, 1) },
      timeZone: ROME,
      include: userId => userId === to.userId,
    });

    expect(tasks.find(task => task.userId === to.userId)?.text ?? '').toContain('Malformed date');
  });
});
