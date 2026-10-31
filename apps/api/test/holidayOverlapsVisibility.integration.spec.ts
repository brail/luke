/**
 * `seasonCalendar.holidayOverlapsForGroup` names events, so it answers as the calendar does
 * (ADR-040): an event visible only to some functions is listed for a member of them, for an admin,
 * and for a user it was shared with. Anyone else with access to the brand learns only how many.
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
let memberId: string;
let restrictedId: string;

const VENDOR_COUNTRIES = ['FR', 'DE'];

const overlapsFor = (session: UserSession) =>
  createCallerWithSession(session).seasonCalendar.holidayOverlapsForGroup({ planningGroupId: calendar.planningGroupId });

/** The titles of the events the caller is told land on a non-working day. */
async function overlapsSeenBy(session: UserSession) {
  const { entries } = await overlapsFor(session);
  return [...new Set(entries.map(o => o.eventTitle))].sort();
}

beforeAll(async () => {
  prisma = await setupTestDb();
  calendar = await createCalendarFixture(prisma, { prefix: 'HOV' });
  const [adminUser, memberUser, outsiderUser] = await Promise.all([createTestUser('admin'), createTestUser('editor'), createTestUser('editor')]);
  admin = adminUser.session;
  member = memberUser.session;
  memberId = memberUser.user.id;
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

  it('leaves it out for someone else with access to the brand, who learns only how many there are', async () => {
    expect(await overlapsSeenBy(outsider.session)).toEqual(['Pubblico']);
    expect((await overlapsFor(outsider.session)).hiddenCount).toBe(1);
  });

  it('counts nothing hidden for a member of the function or an admin', async () => {
    expect((await overlapsFor(member)).hiddenCount).toBe(0);
    expect((await overlapsFor(admin)).hiddenCount).toBe(0);
  });

  it('counts a hidden event once, however many reasons flag it', async () => {
    const { functionId } = await grantBrandAccess(prisma, { brandIds: [calendar.brandId], userIds: [memberId], label: 'Doppio' });
    const group = await prisma.planningGroup.create({ data: { calendarId: calendar.calendarId, name: `Doppio ${randomUUID().substring(0, 6)}` } });
    const phase = await prisma.phase.create({ data: { value: `HOV_${randomUUID().substring(0, 6)}`, label: 'Fase doppia', isActive: true } });
    const event = await prisma.calendarEvent.create({
      data: {
        calendarId: calendar.calendarId, planningGroupId: group.id, phaseId: phase.id, title: 'Doppio',
        startAt: new Date('2031-03-03'), allDay: true, calendarDaysRelevance: 'BOTH',
      },
    });
    await prisma.calendarEventVisibility.create({ data: { eventId: event.id, functionId } });
    await prisma.holidayCountry.createMany({
      data: VENDOR_COUNTRIES.map(code => ({ code, name: code })),
      skipDuplicates: true,
    });
    await prisma.holiday.createMany({
      data: VENDOR_COUNTRIES.map(countryCode => ({ countryCode, name: 'Festa', startDate: new Date('2031-03-03'), endDate: new Date('2031-03-03') })),
    });
    const layout = await prisma.collectionLayout.create({ data: { brandId: calendar.brandId, seasonId: calendar.seasonId } });
    const collectionGroup = await prisma.collectionGroup.create({ data: { collectionLayoutId: layout.id, name: 'Gruppo' } });
    for (const countryCode of VENDOR_COUNTRIES) {
      const vendor = await prisma.vendor.create({ data: { name: `V ${countryCode} ${randomUUID().substring(0, 6)}`, countryCode } });
      await prisma.collectionLayoutRow.create({
        data: {
          collectionLayoutId: layout.id, groupId: collectionGroup.id, planningGroupId: group.id, vendorId: vendor.id,
          gender: 'MAN', line: countryCode, status: 'TEST', productCategory: 'TEST',
        },
      });
    }

    const full = await createCallerWithSession(member).seasonCalendar.holidayOverlapsForGroup({ planningGroupId: group.id });
    const seen = await createCallerWithSession(outsider.session).seasonCalendar.holidayOverlapsForGroup({ planningGroupId: group.id });

    expect(full.entries.length).toBeGreaterThan(1);
    expect(seen).toEqual({ entries: [], hiddenCount: 1 });
  });

  it('lists it once it is shared with that user', async () => {
    await prisma.calendarEventUserVisibility.create({ data: { eventId: restrictedId, userId: outsider.id } });

    expect(await overlapsSeenBy(outsider.session)).toEqual(['Pubblico', 'Riservato']);
  });
});
