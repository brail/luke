/**
 * `seasonCalendar.holidayOverlapsForGroup` names events, so it is a calendar read path (ADR-014):
 * an event visible only to some functions is listed for a member of them, for an admin, and for a
 * user it was shared with — never for anyone else with access to the brand.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCalendarFixture, createCallerWithSession, createTestUser, grantBrandAccess, setupTestDb, type CalendarFixture } from './helpers';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let calendar: CalendarFixture;
let admin: UserSession;
let member: UserSession;
let outsider: { session: UserSession; id: string };
let restrictedId: string;

/** The titles of the events the caller is told land on a non-working day. */
async function overlapsSeenBy(session: UserSession) {
  const overlaps = await createCallerWithSession(session).seasonCalendar.holidayOverlapsForGroup({ planningGroupId: calendar.planningGroupId });
  return [...new Set(overlaps.map(o => o.eventTitle))].sort();
}

beforeAll(async () => {
  prisma = await setupTestDb();
  calendar = await createCalendarFixture(prisma, { prefix: 'HOV' });
  const [adminUser, memberUser, outsiderUser] = await Promise.all([createTestUser('admin'), createTestUser('editor'), createTestUser('editor')]);
  admin = adminUser.session;
  member = memberUser.session;
  outsider = { session: outsiderUser.session, id: outsiderUser.user.id };
  // Same brand, two functions: the event is restricted to the member's.
  const { functionId } = await grantBrandAccess(prisma, { brandIds: [calendar.brandId], userIds: [memberUser.user.id], label: 'Prodotto' });
  await grantBrandAccess(prisma, { brandIds: [calendar.brandId], userIds: [outsiderUser.user.id], label: 'Vendite' });

  const phase = await prisma.phase.create({ data: { value: `HOV_${randomUUID().substring(0, 6)}`, label: 'Fase', isActive: true } });
  // Both on a Saturday, with a countdown that counts working days: both are flagged.
  const saturday = (title: string, day: string) => ({
    calendarId: calendar.calendarId, planningGroupId: calendar.planningGroupId, phaseId: phase.id,
    title, startAt: new Date(day), allDay: true, calendarDaysRelevance: 'COMPANY' as const,
  });
  const restricted = await prisma.calendarEvent.create({ data: saturday('Riservato', '2031-03-01') });
  restrictedId = restricted.id;
  await prisma.calendarEventVisibility.create({ data: { eventId: restricted.id, functionId } });
  // No visibility rows: visible to the whole brand.
  await prisma.calendarEvent.create({ data: { ...saturday('Pubblico', '2031-03-08'), phaseId: (await prisma.phase.create({ data: { value: `HOV2_${randomUUID().substring(0, 6)}`, label: 'Fase 2', isActive: true } })).id } });
});

describe('seasonCalendar.holidayOverlapsForGroup', () => {
  it('lists a function-restricted event for a member of the function and for an admin', async () => {
    expect(await overlapsSeenBy(member)).toEqual(['Pubblico', 'Riservato']);
    expect(await overlapsSeenBy(admin)).toEqual(['Pubblico', 'Riservato']);
  });

  it('leaves it out for someone else with access to the brand', async () => {
    expect(await overlapsSeenBy(outsider.session)).toEqual(['Pubblico']);
  });

  it('lists it once it is shared with that user', async () => {
    await prisma.calendarEventUserVisibility.create({ data: { eventId: restrictedId, userId: outsider.id } });

    expect(await overlapsSeenBy(outsider.session)).toEqual(['Pubblico', 'Riservato']);
  });
});
