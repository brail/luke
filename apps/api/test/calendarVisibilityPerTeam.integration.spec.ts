/**
 * A team grants its function on its own brands only (ADR-041). A user in team (F1, brand A) and
 * team (F2, brand B) holds the pairs (F1, A) and (F2, B), never (F2, A): an event of brand A
 * visible only to F2 is hidden from them everywhere it is read, and they are not notified about
 * it. The same rule holds for admins' notifications (they read everything), for the whole-brand
 * fallback (only an event with no visibility rows of either kind), and for the Google Calendar
 * subscribe panel.
 */

import fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { HARD_DELETE_CONFIRM_PHRASE } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createToken, type UserSession } from '../src/lib/auth';
import seasonCalendarExportRoutes from '../src/routes/seasonCalendarExport.routes';
import { resolveEventAudienceOne } from '../src/services/calendarAudience.service';
import { visibilityOf } from '../src/services/eventMasking.service';

import {
  createCallerWithSession,
  createTestContext,
  createTestUser,
  expectToThrow,
  setupTestDb,
} from './helpers';
import { createCalendarFixture, expectedOf, grantBrandAccess } from './helpers/calendarFixture';

let prisma: PrismaClient;
let app: FastifyInstance;

let seasonId: string;
let brandA: string;
let brandB: string;
let calendarA: string;
let calendarB: string;
let groupA: string;
let fnF1: string;
let fnF2: string;

/** In team (F1, A) and team (F2, B). */
let twoTeams: { id: string; session: UserSession };
/** In team (F2, A): the one who does hold (F2, A). */
let f2InA: { id: string; session: UserSession };
/** In team (F1, A) only, and the one a person-only event is shared with. */
let sharedWith: { id: string; session: UserSession };
let adminNoTeam: { id: string; session: UserSession };
let adminWrongBrand: { id: string; session: UserSession };
let adminMatching: { id: string; session: UserSession };

let f2OnA: string; // brand A, visible to F2 only — the pair the two-team user lacks
let f1OnA: string; // brand A, visible to F1
let f2OnB: string; // brand B, visible to F2
let zeroRow: string; // brand A, no visibility rows: whole brand
let personOnly: string; // brand A, shared with `sharedWith` only, no function

async function user(role: 'admin' | 'editor' | 'viewer') {
  const { user: row, session } = await createTestUser(role);
  return { id: row.id as string, session };
}

function bearer(session: UserSession): string {
  const u = session.user;
  return `Bearer ${createToken({ id: u.id, email: u.email, username: u.username, role: u.role, tokenVersion: 0 }, Math.floor(Date.now() / 1000))}`;
}

async function event(calendarId: string, planningGroupId: string, title: string, functionIds: string[]) {
  const row = await prisma.calendarEvent.create({
    data: { calendarId, planningGroupId, title, startAt: new Date('2096-03-02') },
  });
  for (const functionId of functionIds) {
    await prisma.calendarEventVisibility.create({ data: { eventId: row.id, functionId } });
  }
  return row.id;
}

beforeAll(async () => {
  prisma = await setupTestDb();

  const fixture = await createCalendarFixture(prisma, { prefix: 'VPT', year: 2096 });
  seasonId = fixture.seasonId;
  brandA = fixture.brandId;
  calendarA = fixture.calendarId;
  groupA = fixture.planningGroupId;

  brandB = (await prisma.brand.create({ data: { code: `VPTB${Date.now() % 100000}`, name: 'Per-team B', isActive: true } })).id;
  calendarB = (await prisma.seasonCalendar.create({ data: { brandId: brandB, seasonId } })).id;
  const groupB = (await prisma.planningGroup.create({ data: { calendarId: calendarB, name: 'Group B' } })).id;

  [twoTeams, f2InA, sharedWith, adminNoTeam, adminWrongBrand, adminMatching] = await Promise.all([
    user('editor'), user('editor'), user('editor'), user('admin'), user('admin'), user('admin'),
  ]);

  fnF1 = (await grantBrandAccess(prisma, { brandIds: [brandA], userIds: [twoTeams.id, sharedWith.id], label: 'F1/A' })).functionId;
  fnF2 = (await grantBrandAccess(prisma, { brandIds: [brandB], userIds: [twoTeams.id, adminWrongBrand.id], label: 'F2/B' })).functionId;
  await grantBrandAccess(prisma, { functionId: fnF2, brandIds: [brandA], userIds: [f2InA.id, adminMatching.id], label: 'F2/A' });

  f2OnA = await event(calendarA, groupA, 'F2 on A', [fnF2]);
  f1OnA = await event(calendarA, groupA, 'F1 on A', [fnF1]);
  f2OnB = await event(calendarB, groupB, 'F2 on B', [fnF2]);
  zeroRow = await event(calendarA, groupA, 'Zero rows on A', []);
  personOnly = await event(calendarA, groupA, 'Person only on A', []);
  await prisma.calendarEventUserVisibility.create({ data: { eventId: personOnly, userId: sharedWith.id, grantedBy: adminNoTeam.id } });

  app = fastify({ logger: false });
  await app.register(seasonCalendarExportRoutes, { prisma });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

const listedTo = async (session: UserSession) =>
  (await createCallerWithSession(session).seasonCalendar.listMilestones({ seasonId, brandIds: [brandA, brandB] })).map(e => e.id);

describe('reading: a pair must come from one team', () => {
  it('the list hides the event of a pair the user holds only across two teams', async () => {
    const ids = await listedTo(twoTeams.session);

    expect(ids).not.toContain(f2OnA);
    expect(ids).toEqual(expect.arrayContaining([f1OnA, f2OnB, zeroRow]));
  });

  it('opening it by id answers as for an event that does not exist', async () => {
    await expectToThrow(
      createCallerWithSession(twoTeams.session).seasonCalendar.locate({ eventId: f2OnA }),
      { code: 'NOT_FOUND' }
    );
  });

  it('a write by id answers as for an event that does not exist', async () => {
    await expectToThrow(
      createCallerWithSession(twoTeams.session).seasonCalendar.updateMilestone({
        id: f2OnA, expected: await expectedOf(prisma, f2OnA), data: { title: 'Taken over' },
      }),
      { code: 'NOT_FOUND' }
    );
  });

  it('it is masked where it is named outside the calendar', async () => {
    const visible = await visibilityOf(createTestContext(twoTeams.session), [f2OnA, f1OnA]);
    expect(visible(f2OnA)).toBe(false);
    expect(visible(f1OnA)).toBe(true);
  });

  it('the last-change widget does not answer for it', async () => {
    await prisma.auditLog.create({ data: { action: 'TEST_CHANGE', targetType: 'CalendarEvent', targetId: f2OnA, result: 'SUCCESS', actorId: adminNoTeam.id } });

    expect(await createCallerWithSession(twoTeams.session).auditLog.getLastChange({ targetType: 'CalendarEvent', targetId: f2OnA })).toBeNull();
    expect(await createCallerWithSession(f2InA.session).auditLog.getLastChange({ targetType: 'CalendarEvent', targetId: f2OnA })).not.toBeNull();
  });

  it('saving an event for that pair only asks to confirm that the saver will lose it', async () => {
    await expectToThrow(
      createCallerWithSession(twoTeams.session).seasonCalendar.updateMilestone({
        id: f1OnA, expected: await expectedOf(prisma, f1OnA), data: { visibilityFunctionIds: [fnF2] },
      }),
      { code: 'PRECONDITION_REQUIRED' }
    );
  });

  it('the export leaves it out', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/download/season-calendar/ical?seasonId=${seasonId}&brandIds=${brandA}`,
      headers: { authorization: bearer(twoTeams.session) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('F1 on A');
    expect(res.body).not.toContain('F2 on A');
  });

  it('whoever holds the pair in one team still sees it', async () => {
    expect(await listedTo(f2InA.session)).toContain(f2OnA);
  });
});

describe('notifying: the same rule', () => {
  it('the two-team user is not in the audience; the member of team (F2, A) is', async () => {
    const audience = await resolveEventAudienceOne(f2OnA, prisma);

    expect(audience).not.toContain(twoTeams.id);
    expect(audience).toContain(f2InA.id);
  });

  it('an admin is notified only through a team holding the pair', async () => {
    const audience = await resolveEventAudienceOne(f2OnA, prisma);

    expect(audience).toContain(adminMatching.id);
    expect(audience).not.toContain(adminWrongBrand.id);
    expect(audience).not.toContain(adminNoTeam.id);
  });

  it('the snapshot a deletion leaves for the digest follows the rule', async () => {
    const doomed = await event(calendarA, groupA, 'Doomed F2 on A', [fnF2]);

    await createCallerWithSession(adminNoTeam.session).seasonCalendar.deleteMilestone({ id: doomed });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'CALENDAR_MILESTONE_DELETE', targetId: doomed } });
    const visibleUserIds = (audit.metadata as { visibleUserIds?: string[] }).visibleUserIds ?? [];
    expect(visibleUserIds).toContain(f2InA.id);
    expect(visibleUserIds).not.toContain(twoTeams.id);
  });
});

describe('the whole-brand fallback: only with no visibility rows at all', () => {
  it('an event with no rows reaches the brand, admins only through a team holding the brand', async () => {
    const audience = await resolveEventAudienceOne(zeroRow, prisma);

    expect(audience).toEqual(expect.arrayContaining([twoTeams.id, sharedWith.id, f2InA.id, adminMatching.id]));
    expect(audience).not.toContain(adminNoTeam.id);
    expect(audience).not.toContain(adminWrongBrand.id);
  });

  it('an event shared with one person only is read and notified to that person only', async () => {
    expect(await listedTo(sharedWith.session)).toContain(personOnly);
    expect(await listedTo(twoTeams.session)).not.toContain(personOnly);
    expect(await listedTo(adminNoTeam.session)).toContain(personOnly);
    expect(await resolveEventAudienceOne(personOnly, prisma)).toEqual([sharedWith.id]);
  });

  it('an event with no function cannot be shared with a person: it would stop reaching the brand', async () => {
    await expectToThrow(
      createCallerWithSession(adminNoTeam.session).seasonCalendar.grantUserVisibility({ eventId: zeroRow, userIds: [sharedWith.id] }),
      { code: 'PRECONDITION_FAILED' }
    );
    expect(await prisma.calendarEventUserVisibility.count({ where: { eventId: zeroRow } })).toBe(0);
  });

  it('an event already shared only with people takes another person', async () => {
    const shared = await event(calendarA, groupA, 'Shared with two', []);
    await prisma.calendarEventUserVisibility.create({ data: { eventId: shared, userId: sharedWith.id, grantedBy: adminNoTeam.id } });

    await createCallerWithSession(adminNoTeam.session).seasonCalendar.grantUserVisibility({ eventId: shared, userIds: [f2InA.id] });

    expect((await resolveEventAudienceOne(shared, prisma)).sort()).toEqual([sharedWith.id, f2InA.id].sort());
  });

  it('a user who is the only person of a person-only event cannot be deleted: it would reach the whole brand', async () => {
    const leaving = await user('editor');
    await grantBrandAccess(prisma, { functionId: fnF1, brandIds: [brandA], userIds: [leaving.id], label: 'Leaving' });
    const stranded = await event(calendarA, groupA, 'Only the leaver', []);
    await prisma.calendarEventUserVisibility.create({ data: { eventId: stranded, userId: leaving.id, grantedBy: adminNoTeam.id } });

    await expectToThrow(
      createCallerWithSession(adminNoTeam.session).users.hardDelete({ id: leaving.id, confirmPhrase: HARD_DELETE_CONFIRM_PHRASE }),
      { code: 'PRECONDITION_FAILED' }
    );
    expect(await prisma.user.count({ where: { id: leaving.id } })).toBe(1);
  });

  it('the last person of a person-only event cannot be removed: it would reach the whole brand', async () => {
    await expectToThrow(
      createCallerWithSession(adminNoTeam.session).seasonCalendar.revokeUserVisibility({ eventId: personOnly, userIds: [sharedWith.id] }),
      { code: 'PRECONDITION_FAILED' }
    );
    expect(await prisma.calendarEventUserVisibility.count({ where: { eventId: personOnly } })).toBe(1);
  });

  it('a group holding a person-only event is not copied: the copy would reach the whole brand', async () => {
    const target = await createCalendarFixture(prisma, { prefix: 'VPC', year: 2096 });
    const before = await prisma.calendarEvent.count({ where: { calendarId: target.calendarId } });

    const refusal = await createCallerWithSession(adminNoTeam.session).seasonCalendar.cloneFromBrandSeason({
      sourceBrandId: brandA, sourceSeasonId: seasonId, targetBrandId: target.brandId, targetSeasonId: target.seasonId,
      sourcePlanningGroupIds: [groupA], dateShiftDays: 7, includeCancelled: false,
    }).catch((err: unknown) => err);

    expect(refusal).toMatchObject({ code: 'PRECONDITION_FAILED' });
    // Named, as every clone refusal, only to a caller who can list it.
    expect((refusal as Error).message).toContain('Person only on A');
    expect(await prisma.calendarEvent.count({ where: { calendarId: target.calendarId } })).toBe(before);
  });
});

describe('Google Calendar subscribe panel', () => {
  it('lists a calendar only for a team holding its function and brand; admins see all', async () => {
    await prisma.googleCalendarBinding.createMany({
      data: [
        { seasonCalendarId: calendarA, companyFunctionId: fnF1, googleCalendarId: 'gcal-F1-A', isProvisioned: true },
        { seasonCalendarId: calendarA, companyFunctionId: fnF2, googleCalendarId: 'gcal-F2-A', isProvisioned: true },
      ],
    });

    const forTwoTeams = await createCallerWithSession(twoTeams.session).seasonCalendar.listGoogleCalendarBindings({ calendarId: calendarA });
    const forAdmin = await createCallerWithSession(adminNoTeam.session).seasonCalendar.listGoogleCalendarBindings({ calendarId: calendarA });

    expect(forTwoTeams.map(b => b.googleCalendarId)).toEqual(['gcal-F1-A']);
    expect(forAdmin.map(b => b.googleCalendarId).sort()).toEqual(['gcal-F1-A', 'gcal-F2-A']);
  });
});
