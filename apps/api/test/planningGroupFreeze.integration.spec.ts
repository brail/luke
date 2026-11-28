/**
 * Freezing a planning group (#159): each group plans only the phases it needs, so a freeze no longer
 * requires an event for every active phase of the catalog. The baseline is still snapshotted, and a
 * second freeze is still refused.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCalendarFixture, createCallerWithSession, createTestUser, setupTestDb, type CalendarFixture } from './helpers';
import { holdCalendarFreezeLock, whileHeld } from './helpers/heldTransaction';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let admin: UserSession;
let calendar: CalendarFixture;

beforeAll(async () => {
  prisma = await setupTestDb();
  admin = (await createTestUser('admin')).session;
  calendar = await createCalendarFixture(prisma, { prefix: 'PGF' });
});

describe('seasonCalendar.freezePlanningGroup', () => {
  it('freezes a group that plans only some of the active phases, and snapshots its baseline', async () => {
    const uid = randomUUID().substring(0, 6);
    // Two active phases in the catalog, the group plans one of them.
    const [planned] = await Promise.all([
      prisma.phase.create({ data: { value: `PGF1_${uid}`, label: 'Pianificata', isActive: true } }),
      prisma.phase.create({ data: { value: `PGF2_${uid}`, label: 'Non pianificata', isActive: true } }),
    ]);
    const startAt = new Date('2031-05-04');
    const event = await prisma.calendarEvent.create({
      data: { calendarId: calendar.calendarId, planningGroupId: calendar.planningGroupId, phaseId: planned.id, title: 'Gate', startAt, allDay: true },
    });

    const frozen = await createCallerWithSession(admin).seasonCalendar.freezePlanningGroup({ planningGroupId: calendar.planningGroupId });

    expect(frozen.frozenAt).not.toBeNull();
    expect(await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id }, select: { baselineStartAt: true } }))
      .toEqual({ baselineStartAt: startAt });
    await expect(createCallerWithSession(admin).seasonCalendar.freezePlanningGroup({ planningGroupId: calendar.planningGroupId }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('amend and unfreeze take the freeze lock (#249)', () => {
  it('an amend that waited for an unfreeze finds the group unfrozen and writes no baseline', async () => {
    const group = await createCalendarFixture(prisma, { prefix: 'PGA' });
    const event = await prisma.calendarEvent.create({
      data: { calendarId: group.calendarId, planningGroupId: group.planningGroupId, title: 'Late', startAt: new Date('2031-06-01'), allDay: true },
    });
    await prisma.planningGroup.update({ where: { id: group.planningGroupId }, data: { frozenAt: new Date() } });

    // The unfreeze holds the lock and commits while the amend waits on it.
    const outcome = await whileHeld(
      holdCalendarFreezeLock,
      () => createCallerWithSession(admin).seasonCalendar.amendPlanningGroupFreeze({ planningGroupId: group.planningGroupId }),
      holder => holder.query('UPDATE planning_groups SET "frozenAt" = NULL WHERE id = $1', [group.planningGroupId])
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'CONFLICT' } });
    expect(await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id }, select: { baselineStartAt: true } }))
      .toEqual({ baselineStartAt: null });
  });

  it('an unfreeze waits for the lock, then clears the freeze and every baseline', async () => {
    const group = await createCalendarFixture(prisma, { prefix: 'PGU' });
    const startAt = new Date('2031-06-01');
    const event = await prisma.calendarEvent.create({
      data: { calendarId: group.calendarId, planningGroupId: group.planningGroupId, title: 'Gate', startAt, allDay: true, baselineStartAt: startAt },
    });
    await prisma.planningGroup.update({ where: { id: group.planningGroupId }, data: { frozenAt: new Date() } });

    const outcome = await whileHeld(
      holdCalendarFreezeLock,
      () => createCallerWithSession(admin).seasonCalendar.unfreezePlanningGroup({ planningGroupId: group.planningGroupId })
    );

    expect(outcome.status).toBe('fulfilled');
    expect((await prisma.planningGroup.findUniqueOrThrow({ where: { id: group.planningGroupId } })).frozenAt).toBeNull();
    expect(await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id }, select: { baselineStartAt: true } }))
      .toEqual({ baselineStartAt: null });
  });

  it('an amend gives an event added after the freeze its own baseline', async () => {
    const group = await createCalendarFixture(prisma, { prefix: 'PGB' });
    await prisma.planningGroup.update({ where: { id: group.planningGroupId }, data: { frozenAt: new Date() } });
    const startAt = new Date('2031-07-01');
    const event = await prisma.calendarEvent.create({
      data: { calendarId: group.calendarId, planningGroupId: group.planningGroupId, title: 'Later', startAt, allDay: true },
    });

    const result = await createCallerWithSession(admin).seasonCalendar.amendPlanningGroupFreeze({ planningGroupId: group.planningGroupId });

    expect(result.amendedCount).toBe(1);
    expect(await prisma.calendarEvent.findUniqueOrThrow({ where: { id: event.id }, select: { baselineStartAt: true } }))
      .toEqual({ baselineStartAt: startAt });
  });
});
