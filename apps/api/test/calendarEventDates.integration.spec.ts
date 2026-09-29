/**
 * What an event's dates may be stored as.
 *
 * An all-day value is a calendar date stored at UTC midnight: anything else is read as another day
 * by some reader. An end never precedes its start. Both are judged on the result a write leaves in
 * the row — create, update and reschedule merge differently with what is stored — and only when
 * the write touches the dates, so a row already stored off midnight stays editable otherwise. The
 * write is conditional on the dates it was validated against, so two requests read from the same
 * row cannot each pass alone and leave a combination neither was checked for.
 */

import { randomUUID } from 'crypto';

import { TRPCError } from '@trpc/server';
import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { assertEventDates, rescheduleMilestone, updateMilestone } from '../src/services/seasonCalendar.service';

import { createCalendarFixture, createCallerWithSession, createTestUser, setupTestDb } from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let adminSession: UserSession;
let calendarId: string;
let planningGroupId: string;
let fnA: string;
let fnB: string;
let source: { brandId: string; seasonId: string };
let target: { brandId: string; seasonId: string };

const asAdmin = () => createCallerWithSession(adminSession);

const MIDNIGHT = new Date('2099-06-01T00:00:00.000Z');
const NEXT_MIDNIGHT = new Date('2099-06-02T00:00:00.000Z');
/** Where the Gantt defect stored an all-day 2 June for a Rome user: 22:00 UTC on 1 June. */
const ROME_LOCAL_MIDNIGHT = new Date('2099-06-01T22:00:00.000Z');

async function createEvent(opts: { groupId?: string; startAt: Date; endAt?: Date | null; allDay: boolean }) {
  return prisma.calendarEvent.create({
    data: {
      calendarId,
      planningGroupId: opts.groupId ?? planningGroupId,
      title: `Evento ${randomUUID().slice(0, 8)}`,
      startAt: opts.startAt,
      endAt: opts.endAt ?? null,
      allDay: opts.allDay,
      visibilities: { create: [{ functionId: fnA }] },
    },
  });
}

async function expectBadRequest(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({ code: 'BAD_REQUEST' });
}

beforeAll(async () => {
  prisma = await setupTestDb();
  adminSession = (await createTestUser('admin')).session;
  const fixture = await createCalendarFixture(prisma, { prefix: 'EVD', groupName: 'Dates group' });
  calendarId = fixture.calendarId;
  planningGroupId = fixture.planningGroupId;
  source = { brandId: fixture.brandId, seasonId: fixture.seasonId };
  const other = await createCalendarFixture(prisma, { prefix: 'EVT', groupName: 'Target group' });
  target = { brandId: other.brandId, seasonId: other.seasonId };
  const uid = randomUUID().slice(0, 6);
  [fnA, fnB] = (await Promise.all([
    prisma.companyFunction.create({ data: { slug: `evd_a_${uid}`, name: 'Dates A', order: 93, isActive: true } }),
    prisma.companyFunction.create({ data: { slug: `evd_b_${uid}`, name: 'Dates B', order: 94, isActive: true } }),
  ])).map(f => f.id);
});

describe('an all-day event is stored at UTC midnight', () => {
  const create = (startAt: Date, endAt?: Date) => asAdmin().seasonCalendar.createMilestone({
    planningGroupId, title: 'Nuovo', startAt: startAt.toISOString(), endAt: endAt?.toISOString(),
    allDay: true, publishExternally: false, visibilityFunctionIds: [fnA],
  });

  it('create: refused off midnight, on either end; accepted at midnight', async () => {
    await expectBadRequest(create(ROME_LOCAL_MIDNIGHT));
    await expectBadRequest(create(MIDNIGHT, ROME_LOCAL_MIDNIGHT));
    await expect(create(MIDNIGHT, NEXT_MIDNIGHT)).resolves.toMatchObject({ allDay: true });
  });

  it('update: turning a timed event all-day without moving it off 09:00 is refused, and nothing is written', async () => {
    const event = await createEvent({ startAt: new Date('2099-06-01T09:00:00.000Z'), allDay: false });
    await expectBadRequest(asAdmin().seasonCalendar.updateMilestone({ id: event.id, data: { allDay: true } }));
    expect(await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ allDay: false });
  });

  it('update: turning it all-day together with midnight dates is accepted', async () => {
    const event = await createEvent({ startAt: new Date('2099-06-01T09:00:00.000Z'), allDay: false });
    await asAdmin().seasonCalendar.updateMilestone({ id: event.id, data: { allDay: true, startAt: MIDNIGHT.toISOString() } });
    expect(await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ allDay: true, startAt: MIDNIGHT });
  });

  it('update: a row already stored off midnight stays editable while the dates are not touched', async () => {
    const legacy = await createEvent({ startAt: ROME_LOCAL_MIDNIGHT, allDay: true });
    await asAdmin().seasonCalendar.updateMilestone({ id: legacy.id, data: { title: 'Rinominato' } });
    expect(await prisma.calendarEvent.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ title: 'Rinominato', startAt: ROME_LOCAL_MIDNIGHT });
  });

  it('update: moving only the end of such a row is refused — its start stays off midnight', async () => {
    const legacy = await createEvent({ startAt: ROME_LOCAL_MIDNIGHT, endAt: new Date('2099-06-03T22:00:00.000Z'), allDay: true });
    await expectBadRequest(asAdmin().seasonCalendar.updateMilestone({ id: legacy.id, data: { endAt: new Date('2099-06-02T00:00:00.000Z').toISOString() } }));
  });

  it('reschedule: refused off midnight; moving a legacy row onto midnight dates repairs it', async () => {
    const legacy = await createEvent({ startAt: ROME_LOCAL_MIDNIGHT, allDay: true });
    await expectBadRequest(asAdmin().seasonCalendar.rescheduleMilestone({ id: legacy.id, startAt: ROME_LOCAL_MIDNIGHT.toISOString(), reason: 'prova' }));
    await asAdmin().seasonCalendar.rescheduleMilestone({ id: legacy.id, startAt: NEXT_MIDNIGHT.toISOString(), reason: 'prova' });
    expect(await prisma.calendarEvent.findUniqueOrThrow({ where: { id: legacy.id } })).toMatchObject({ startAt: NEXT_MIDNIGHT, endAt: null });
  });
});

describe('assertEventDates', () => {
  it('reads midnight by the epoch remainder, before 1970 too', () => {
    expect(() => assertEventDates({ startAt: new Date('1900-01-01T00:00:00.000Z'), endAt: null, allDay: true })).not.toThrow();
    expect(() => assertEventDates({ startAt: new Date('1969-12-31T22:00:00.000Z'), endAt: null, allDay: true })).toThrow(TRPCError);
  });
});

describe('an event never ends before it starts', () => {
  it('is refused on create, update and reschedule, timed or all-day', async () => {
    await expectBadRequest(asAdmin().seasonCalendar.createMilestone({
      planningGroupId, title: 'Rovesciato', startAt: '2099-06-01T10:00:00.000Z', endAt: '2099-06-01T09:00:00.000Z',
      allDay: false, publishExternally: false, visibilityFunctionIds: [fnA],
    }));
    const timed = await createEvent({ startAt: new Date('2099-06-01T10:00:00.000Z'), allDay: false });
    await expectBadRequest(asAdmin().seasonCalendar.updateMilestone({ id: timed.id, data: { endAt: '2099-06-01T09:00:00.000Z' } }));
    const allDay = await createEvent({ startAt: NEXT_MIDNIGHT, allDay: true });
    await expectBadRequest(asAdmin().seasonCalendar.rescheduleMilestone({
      id: allDay.id, startAt: NEXT_MIDNIGHT.toISOString(), endAt: MIDNIGHT.toISOString(), reason: 'prova',
    }));
  });
});

describe('a write is conditional on the dates it was validated against', () => {
  it('two updates read from the same row: the second is refused once the first has moved it', async () => {
    // Timed at 00:00 UTC: turning it all-day passes alone, and so does moving it to 09:00 — both
    // together would store an all-day event at 09:00.
    const event = await createEvent({ startAt: MIDNIGHT, allDay: false });
    const read = { startAt: event.startAt, endAt: event.endAt, allDay: event.allDay };

    await updateMilestone(event.id, { startAt: '2099-06-01T09:00:00.000Z' }, prisma, read);
    const second = updateMilestone(event.id, { allDay: true, visibilityFunctionIds: [fnB] }, prisma, read);
    await expect(second).rejects.toBeInstanceOf(TRPCError);
    await expect(second).rejects.toMatchObject({ code: 'CONFLICT' });

    const row = await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id }, include: { visibilities: true } });
    expect(row).toMatchObject({ allDay: false, startAt: new Date('2099-06-01T09:00:00.000Z') });
    // The visibility replacement shares the transaction: nothing of the refused write survives.
    expect(row.visibilities.map(v => v.functionId)).toEqual([fnA]);
  });

  it('an edit that does not touch the dates is refused too once they moved — the lock was judged on them', async () => {
    const event = await createEvent({ startAt: MIDNIGHT, allDay: true });
    const read = { startAt: event.startAt, endAt: event.endAt, allDay: event.allDay };
    await rescheduleMilestone(event.id, NEXT_MIDNIGHT.toISOString(), null, prisma, undefined, read);
    await expect(updateMilestone(event.id, { title: 'Rinominato' }, prisma, read)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ title: event.title });
  });

  it('a write on an event deleted meanwhile is a CONFLICT, not a server error', async () => {
    const event = await createEvent({ startAt: MIDNIGHT, allDay: true });
    const read = { startAt: event.startAt, endAt: event.endAt, allDay: event.allDay };
    await prisma.calendarEvent.delete({ where: { id: event.id } });
    await expect(updateMilestone(event.id, { title: 'Fantasma' }, prisma, read)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('a reschedule validated against dates that changed meanwhile is refused', async () => {
    const event = await createEvent({ startAt: MIDNIGHT, allDay: true });
    const read = { startAt: event.startAt, endAt: event.endAt, allDay: event.allDay };
    await prisma.calendarEvent.update({ where: { id: event.id }, data: { startAt: NEXT_MIDNIGHT } });
    await expect(rescheduleMilestone(event.id, MIDNIGHT.toISOString(), null, prisma, undefined, read)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('cloneFromBrandSeason refuses an all-day source off midnight', () => {
  const clone = (groupId: string, includeCancelled = false) => asAdmin().seasonCalendar.cloneFromBrandSeason({
    sourceBrandId: source.brandId, sourceSeasonId: source.seasonId,
    targetBrandId: target.brandId, targetSeasonId: target.seasonId,
    sourcePlanningGroupIds: [groupId], dateShiftDays: 7, includeCancelled,
  });

  it('clones midnight sources shifted by whole days', async () => {
    const group = await prisma.planningGroup.create({ data: { calendarId, name: `Pulito ${randomUUID().slice(0, 8)}` } });
    await createEvent({ groupId: group.id, startAt: MIDNIGHT, allDay: true });
    await clone(group.id);
    const copied = await prisma.calendarEvent.findMany({ where: { planningGroup: { name: group.name, calendar: target } } });
    expect(copied.map(e => e.startAt)).toEqual([new Date('2099-06-08T00:00:00.000Z')]);
  });

  it('names the offending source event and creates nothing', async () => {
    const group = await prisma.planningGroup.create({ data: { calendarId, name: `Legacy ${randomUUID().slice(0, 8)}` } });
    await createEvent({ groupId: group.id, startAt: MIDNIGHT, allDay: true });
    const legacy = await createEvent({ groupId: group.id, startAt: ROME_LOCAL_MIDNIGHT, allDay: true });
    await expect(clone(group.id)).rejects.toMatchObject({ code: 'BAD_REQUEST', message: expect.stringContaining(legacy.title) });
    expect(await prisma.planningGroup.count({ where: { name: group.name, calendar: target } })).toBe(0);
  });

  it('judges only what it would copy: a cancelled legacy source matters only when cancelled events are cloned', async () => {
    const group = await prisma.planningGroup.create({ data: { calendarId, name: `Annullati ${randomUUID().slice(0, 8)}` } });
    await createEvent({ groupId: group.id, startAt: MIDNIGHT, allDay: true });
    const cancelled = await createEvent({ groupId: group.id, startAt: ROME_LOCAL_MIDNIGHT, allDay: true });
    await prisma.calendarEvent.update({ where: { id: cancelled.id }, data: { cancelledAt: new Date(), cancelReason: 'prova' } });
    await expect(clone(group.id, true)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(clone(group.id)).resolves.toBeDefined();
  });
});
