/**
 * Freezing a planning group (#159): each group plans only the phases it needs, so a freeze no longer
 * requires an event for every active phase of the catalog. The baseline is still snapshotted, and a
 * second freeze is still refused.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCalendarFixture, createCallerWithSession, createTestUser, setupTestDb, type CalendarFixture } from './helpers';

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
