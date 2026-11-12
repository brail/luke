/**
 * Access changes leave their before and after in the audit trail (#222), written in the same
 * transaction as the change, and are kept for the critical retention: a user's role and active
 * state (`USER_ACCESS_CHANGED`), a team's brands and active state, its deletion with the members
 * it had, and a member's role in the team; an approval, a per-person share of a calendar event and
 * the functions an event is visible to; a user's section overrides, the role section defaults and the
 * section kill switch, its deletion included.
 */

import { randomUUID } from 'crypto';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { invalidateRbacCache } from '@luke/core/server';
import type { PrismaClient } from '@luke/db';

import * as auditLog from '../src/lib/auditLog';
import { CRITICAL_AUDIT_ACTIONS } from '../src/lib/auditLog';
import { deleteConfig } from '../src/lib/configManager';

import { createCallerWithSession, createTestUser, expectedOf, expectToThrow, setupTestDb } from './helpers';
import { createCalendarFixture, createTestEvent, createTestTemplate, grantBrandAccess } from './helpers/calendarFixture';
import { whileHeld } from './helpers/heldTransaction';

import type { UserSession } from '../src/lib/auth';

let prisma: PrismaClient;
let admin: UserSession;
let functionId: string;
let brandA: string;
let brandB: string;

const asAdmin = () => createCallerWithSession(admin);

async function rowsOf(action: string, targetId: string) {
  return prisma.auditLog.findMany({ where: { action, targetId }, orderBy: { createdAt: 'asc' } });
}

async function only(action: string, targetId: string) {
  const rows = await rowsOf(action, targetId);
  expect(rows).toHaveLength(1);
  return rows[0].metadata as Record<string, unknown>;
}

beforeAll(async () => {
  prisma = await setupTestDb();
  admin = (await createTestUser('admin')).session;
  const uid = randomUUID().substring(0, 6);
  functionId = (await prisma.companyFunction.create({ data: { slug: `acc_${uid}`, name: `Access ${uid}`, order: 95, isActive: true } })).id;
  [brandA, brandB] = (await Promise.all([
    prisma.brand.create({ data: { code: `ACA${uid}`, name: 'Access A', isActive: true } }),
    prisma.brand.create({ data: { code: `ACB${uid}`, name: 'Access B', isActive: true } }),
  ])).map(b => b.id);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Makes the audit write of `action` fail, leaving every other action's row as it is. */
function failAuditFor(action: string) {
  const real = auditLog.logAudit;
  vi.spyOn(auditLog, 'logAudit').mockImplementation(async (ctx, params, options) => {
    if (params.action === action) throw new Error('audit store unavailable');
    return real(ctx, params, options);
  });
  const realMany = auditLog.logAuditMany;
  vi.spyOn(auditLog, 'logAuditMany').mockImplementation(async (ctx, rows, options) => {
    if (rows.some(row => row.action === action)) throw new Error('audit store unavailable');
    return realMany(ctx, rows, options);
  });
}

describe("a user's role and active state", () => {
  it('a role change records the role before and after', async () => {
    const { user } = await createTestUser('viewer');

    await asAdmin().users.update({ id: user.id, role: 'editor' });

    expect(await only('USER_ACCESS_CHANGED', user.id)).toEqual({ oldRole: 'viewer', newRole: 'editor' });
  });

  it('a deactivation through update records the active state before and after', async () => {
    const { user } = await createTestUser('viewer');

    await asAdmin().users.update({ id: user.id, isActive: false });

    expect(await only('USER_ACCESS_CHANGED', user.id)).toEqual({ oldIsActive: true, newIsActive: false });
  });

  it('an update that changes neither writes no access row', async () => {
    const { user } = await createTestUser('viewer');

    await asAdmin().users.update({ id: user.id, firstName: 'Renamed', role: 'viewer' });

    expect(await rowsOf('USER_ACCESS_CHANGED', user.id)).toHaveLength(0);
  });

  it('a soft delete records the deactivation once; repeating it succeeds and records nothing', async () => {
    const { user } = await createTestUser('viewer');

    const first = await asAdmin().users.softDelete({ id: user.id });
    const second = await asAdmin().users.softDelete({ id: user.id });

    expect(first).toMatchObject({ id: user.id, isActive: false });
    expect(second).toMatchObject({ id: user.id, isActive: false });
    expect(await only('USER_ACCESS_CHANGED', user.id)).toEqual({ oldIsActive: true, newIsActive: false });
  });

  it('a creation records the initial role and active state', async () => {
    const created = await asAdmin().users.create({
      username: `acc-${randomUUID().substring(0, 8)}`,
      email: `acc-${randomUUID().substring(0, 8)}@test.com`,
      password: 'SecurePassword123!',
      role: 'editor',
    });

    expect(await only('USER_ACCESS_CHANGED', created.id)).toEqual({ newRole: 'editor', newIsActive: true });
  });

  it('an approval records the approval and the membership it creates', async () => {
    const { user } = await createTestUser('viewer');
    await prisma.user.update({ where: { id: user.id }, data: { pendingApproval: true } });
    const team = await asAdmin().company.team.create({ functionId, name: `Approval ${randomUUID().substring(0, 6)}` });

    await asAdmin().users.approvePending({ id: user.id, teamId: team.id });

    expect(await only('USER_ACCESS_CHANGED', user.id)).toEqual({ oldPendingApproval: true, newPendingApproval: false });
    expect(await only('COMPANY_TEAM_MEMBER_ADDED', `${team.id}:${user.id}`)).toEqual({ teamId: team.id, userId: user.id, role: 'MEMBER' });
  });

  it('of two approvals of the same user into different teams, one succeeds and is recorded once', async () => {
    const { user } = await createTestUser('viewer');
    await prisma.user.update({ where: { id: user.id }, data: { pendingApproval: true } });
    const [teamA, teamB] = await Promise.all(['A', 'B'].map(t =>
      asAdmin().company.team.create({ functionId, name: `Race ${t} ${randomUUID().substring(0, 6)}` })));

    const results = await Promise.allSettled([
      asAdmin().users.approvePending({ id: user.id, teamId: teamA.id }),
      asAdmin().users.approvePending({ id: user.id, teamId: teamB.id }),
    ]);

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.companyTeamMembership.count({ where: { userId: user.id } })).toBe(1);
    expect(await rowsOf('USER_ACCESS_CHANGED', user.id)).toHaveLength(1);
  });

  it('a change whose access row cannot be written is not saved', async () => {
    const { user } = await createTestUser('viewer');
    failAuditFor('USER_ACCESS_CHANGED');

    await expect(asAdmin().users.update({ id: user.id, role: 'editor' })).rejects.toThrow();

    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe('viewer');
  });

  it('a demotion and a deactivation of the same admin at once both finish', async () => {
    for (let round = 0; round < 3; round++) {
      const { user } = await createTestUser('admin');

      const results = await Promise.allSettled([
        asAdmin().users.update({ id: user.id, role: 'editor' }),
        asAdmin().users.softDelete({ id: user.id }),
      ]);

      for (const r of results) {
        if (r.status === 'rejected') expect(String(r.reason)).not.toMatch(/deadlock|40P01|P2034/i);
      }
    }
  });
});

describe('a team', () => {
  it('a creation records its brands, sorted, and its active state', async () => {
    const team = await asAdmin().company.team.create({ functionId, name: `Create ${randomUUID().substring(0, 6)}`, brandIds: [brandB, brandA] });

    expect(await only('COMPANY_TEAM_CREATED', team.id)).toMatchObject({
      functionId, brandIds: [brandA, brandB].sort(), isActive: true,
    });
  });

  it('a creation without brands records an empty list', async () => {
    const team = await asAdmin().company.team.create({ functionId, name: `Empty ${randomUUID().substring(0, 6)}` });

    expect(await only('COMPANY_TEAM_CREATED', team.id)).toMatchObject({ brandIds: [] });
  });

  it('an update records the brands and the active state before and after, only when they change', async () => {
    const name = `Update ${randomUUID().substring(0, 6)}`;
    const team = await asAdmin().company.team.create({ functionId, name, brandIds: [brandA] });

    await asAdmin().company.team.update({ id: team.id, name, brandIds: [brandB, brandA] });
    await asAdmin().company.team.update({ id: team.id, name, brandIds: [brandA, brandB] });
    await asAdmin().company.team.update({ id: team.id, name, isActive: false });
    await asAdmin().company.team.update({ id: team.id, name: `Renamed ${randomUUID().substring(0, 6)}`, isActive: false });

    const rows = (await rowsOf('COMPANY_TEAM_UPDATED', team.id)).map(r => r.metadata ?? {});
    expect(rows).toEqual([
      { oldBrandIds: [brandA], newBrandIds: [brandA, brandB].sort() },
      {},
      { oldIsActive: true, newIsActive: false },
      {},
    ].map(m => expect.objectContaining(m)));
    expect(rows[1]).not.toHaveProperty('oldBrandIds');
    expect(rows[3]).not.toHaveProperty('oldIsActive');
  });

  it('a deletion records its function, its brands and the members it had', async () => {
    const team = await asAdmin().company.team.create({ functionId, name: `Delete ${randomUUID().substring(0, 6)}`, brandIds: [brandB, brandA] });
    const [m1, m2] = await Promise.all([createTestUser('viewer'), createTestUser('viewer')]);
    await asAdmin().company.team.addMembers({ teamId: team.id, userIds: [m1.user.id, m2.user.id] });

    await asAdmin().company.team.delete({ id: team.id });

    expect(await only('COMPANY_TEAM_DELETED', team.id)).toEqual({
      functionId, brandIds: [brandA, brandB].sort(), userIds: [m1.user.id, m2.user.id].sort(),
    });
  });

  it("a member's role change records the role before and after", async () => {
    const team = await asAdmin().company.team.create({ functionId, name: `Role ${randomUUID().substring(0, 6)}` });
    const { user } = await createTestUser('viewer');
    await asAdmin().company.team.addMembers({ teamId: team.id, userIds: [user.id] });

    await asAdmin().company.team.updateMemberRole({ teamId: team.id, userId: user.id, role: 'LEADER' });

    expect(await only('COMPANY_TEAM_MEMBER_ROLE_UPDATED', `${team.id}:${user.id}`)).toEqual({
      teamId: team.id, userId: user.id, oldRole: 'MEMBER', newRole: 'LEADER',
    });
  });

  it('adding records only who joins: an existing member or a repeated id gets no row', async () => {
    const team = await asAdmin().company.team.create({ functionId, name: `Add ${randomUUID().substring(0, 6)}` });
    const [already, joining] = await Promise.all([createTestUser('viewer'), createTestUser('viewer')]);
    await asAdmin().company.team.addMembers({ teamId: team.id, userIds: [already.user.id] });

    await asAdmin().company.team.addMembers({ teamId: team.id, userIds: [already.user.id, joining.user.id, joining.user.id] });

    expect(await rowsOf('COMPANY_TEAM_MEMBER_ADDED', `${team.id}:${already.user.id}`)).toHaveLength(1);
    expect(await rowsOf('COMPANY_TEAM_MEMBER_ADDED', `${team.id}:${joining.user.id}`)).toHaveLength(1);
  });

  it('adding records the role the member joins with', async () => {
    const team = await asAdmin().company.team.create({ functionId, name: `Leader ${randomUUID().substring(0, 6)}` });
    const { user } = await createTestUser('viewer');

    await asAdmin().company.team.addMembers({ teamId: team.id, userIds: [user.id], role: 'LEADER' });

    expect(await only('COMPANY_TEAM_MEMBER_ADDED', `${team.id}:${user.id}`)).toEqual({ teamId: team.id, userId: user.id, role: 'LEADER' });
  });

  it('removing records only who leaves: someone who was not a member gets no row', async () => {
    const team = await asAdmin().company.team.create({ functionId, name: `Remove ${randomUUID().substring(0, 6)}` });
    const [member, stranger] = await Promise.all([createTestUser('viewer'), createTestUser('viewer')]);
    await asAdmin().company.team.addMembers({ teamId: team.id, userIds: [member.user.id] });

    await asAdmin().company.team.removeMembers({ teamId: team.id, userIds: [member.user.id, stranger.user.id] });

    expect(await rowsOf('COMPANY_TEAM_MEMBER_REMOVED', `${team.id}:${member.user.id}`)).toHaveLength(1);
    expect(await rowsOf('COMPANY_TEAM_MEMBER_REMOVED', `${team.id}:${stranger.user.id}`)).toHaveLength(0);
  });

  it('a role change of someone not in the team answers NOT_FOUND and records nothing', async () => {
    const team = await asAdmin().company.team.create({ functionId, name: `Missing ${randomUUID().substring(0, 6)}` });
    const { user } = await createTestUser('viewer');

    await expectToThrow(asAdmin().company.team.updateMemberRole({ teamId: team.id, userId: user.id, role: 'LEADER' }), { code: 'NOT_FOUND' });
    expect(await rowsOf('COMPANY_TEAM_MEMBER_ROLE_UPDATED', `${team.id}:${user.id}`)).toHaveLength(0);
  });
});

describe('a per-person share of a calendar event', () => {
  let eventId: string;
  let brandId: string;

  beforeAll(async () => {
    const calendar = await createCalendarFixture(prisma, { prefix: 'ACS' });
    brandId = calendar.brandId;
    // A function audience, so that neither a grant nor a revoke runs into the person-only guards.
    eventId = (await createTestEvent(prisma, calendar, [functionId], { title: 'Shared', startAt: new Date('2096-03-02') })).id;
  });

  const notified = (userId: string, title: string) => prisma.notification.count({ where: { userId, title } });

  async function people(count: number) {
    const users = await Promise.all(Array.from({ length: count }, () => createTestUser('viewer')));
    const ids = users.map(u => u.user.id as string);
    await grantBrandAccess(prisma, { brandIds: [brandId], userIds: ids, label: 'Share' });
    return ids;
  }

  it('a grant records only the people it really adds', async () => {
    const [already, joining] = await people(2);
    await prisma.calendarEventUserVisibility.create({ data: { eventId, userId: already, grantedBy: admin.user.id } });

    await asAdmin().seasonCalendar.grantUserVisibility({ eventId, userIds: [already, joining] });

    expect(await rowsOf('CALENDAR_EVENT_USER_VISIBILITY_GRANTED', `${eventId}:${already}`)).toHaveLength(0);
    expect(await only('CALENDAR_EVENT_USER_VISIBILITY_GRANTED', `${eventId}:${joining}`)).toEqual({ eventId, userId: joining });
    // Only the person who gains access is told so.
    expect(await notified(already, 'Accesso evento concesso')).toBe(0);
    expect(await notified(joining, 'Accesso evento concesso')).toBe(1);
  });

  it('a revoke records only the people it really removes', async () => {
    const [shared, stranger] = await people(2);
    await prisma.calendarEventUserVisibility.create({ data: { eventId, userId: shared, grantedBy: admin.user.id } });

    await asAdmin().seasonCalendar.revokeUserVisibility({ eventId, userIds: [shared, stranger] });

    expect(await only('CALENDAR_EVENT_USER_VISIBILITY_REVOKED', `${eventId}:${shared}`)).toEqual({ eventId, userId: shared });
    expect(await rowsOf('CALENDAR_EVENT_USER_VISIBILITY_REVOKED', `${eventId}:${stranger}`)).toHaveLength(0);
    expect(await notified(shared, 'Accesso evento revocato')).toBe(1);
    expect(await notified(stranger, 'Accesso evento revocato')).toBe(0);
  });

  it('a grant whose row cannot be written is not saved', async () => {
    const [refused] = await people(1);
    failAuditFor('CALENDAR_EVENT_USER_VISIBILITY_GRANTED');

    await expect(asAdmin().seasonCalendar.grantUserVisibility({ eventId, userIds: [refused] })).rejects.toThrow();

    expect(await prisma.calendarEventUserVisibility.count({ where: { eventId, userId: refused } })).toBe(0);
  });

  it('a revoke whose row cannot be written is not saved', async () => {
    const [kept] = await people(1);
    await prisma.calendarEventUserVisibility.create({ data: { eventId, userId: kept, grantedBy: admin.user.id } });
    failAuditFor('CALENDAR_EVENT_USER_VISIBILITY_REVOKED');

    await expect(asAdmin().seasonCalendar.revokeUserVisibility({ eventId, userIds: [kept] })).rejects.toThrow();

    expect(await prisma.calendarEventUserVisibility.count({ where: { eventId, userId: kept } })).toBe(1);
  });
});

describe("the functions a calendar event is visible to", () => {
  const VISIBILITY = 'CALENDAR_EVENT_VISIBILITY_CHANGED';
  let calendar: Awaited<ReturnType<typeof createCalendarFixture>>;
  let otherFunctionId: string;

  beforeAll(async () => {
    calendar = await createCalendarFixture(prisma, { prefix: 'ACV' });
    otherFunctionId = (await prisma.companyFunction.create({
      data: { slug: `acv_${calendar.uid}`, name: `Access other ${calendar.uid}`, order: 96, isActive: true },
    })).id;
  });

  /** An event in `groupId` visible to `functionIds`. */
  async function eventFor(functionIds: string[], groupId = calendar.planningGroupId) {
    return (await createTestEvent(prisma, { calendarId: calendar.calendarId, planningGroupId: groupId }, functionIds, {
      startAt: new Date('2096-03-02T00:00:00.000Z'), allDay: true,
    })).id;
  }

  const create = (title: string) => asAdmin().seasonCalendar.createMilestone({
    planningGroupId: calendar.planningGroupId, title, startAt: '2096-03-02T00:00:00.000Z', allDay: true,
    visibilityFunctionIds: [otherFunctionId, functionId],
  });

  async function template(items: { title: string; functionIds: string[] }[]) {
    const [group, tpl] = await Promise.all([
      prisma.planningGroup.create({ data: { calendarId: calendar.calendarId, name: `Template ${randomUUID().slice(0, 8)}` } }),
      createTestTemplate(prisma, items),
    ]);
    return { groupId: group.id, apply: () => asAdmin().seasonCalendar.applyTemplate({ planningGroupId: group.id, templateId: tpl.id, anchorDate: '2096-03-02', force: false }) };
  }

  async function cloneSource() {
    const group = await prisma.planningGroup.create({ data: { calendarId: calendar.calendarId, name: `Source ${randomUUID().slice(0, 8)}` } });
    const [withFunctions, without] = await Promise.all([eventFor([otherFunctionId, functionId], group.id), eventFor([], group.id)]);
    const target = await createCalendarFixture(prisma, { prefix: 'ACT' });
    const clone = () => asAdmin().seasonCalendar.cloneFromBrandSeason({
      sourceBrandId: calendar.brandId, sourceSeasonId: calendar.seasonId, targetBrandId: target.brandId, targetSeasonId: target.seasonId,
      sourcePlanningGroupIds: [group.id], dateShiftDays: 0, includeCancelled: false,
    });
    const titleOf = async (id: string) => (await prisma.calendarEvent.findUniqueOrThrow({ where: { id } })).title;
    const copyOf = async (sourceId: string) =>
      prisma.calendarEvent.findFirst({ where: { calendar: { brandId: target.brandId }, title: await titleOf(sourceId) } });
    return { withFunctions, without, clone, copyOf };
  }

  const both = () => [functionId, otherFunctionId].sort();

  it('a creation records the functions it starts with, sorted', async () => {
    const event = await create(`Created ${randomUUID().slice(0, 8)}`);
    expect(await only(VISIBILITY, event.id)).toEqual({ oldVisibilityFunctionIds: [], newVisibilityFunctionIds: both() });
  });

  it('an update records the functions before and after, only when they change', async () => {
    const id = await eventFor([functionId]);
    await asAdmin().seasonCalendar.updateMilestone({ id, expected: await expectedOf(prisma, id), data: { title: 'Renamed' } });
    await asAdmin().seasonCalendar.updateMilestone({ id, expected: await expectedOf(prisma, id), data: { visibilityFunctionIds: [functionId] } });
    expect(await rowsOf(VISIBILITY, id)).toHaveLength(0);

    await asAdmin().seasonCalendar.updateMilestone({ id, expected: await expectedOf(prisma, id), data: { visibilityFunctionIds: [otherFunctionId, functionId] } });
    expect(await only(VISIBILITY, id)).toEqual({ oldVisibilityFunctionIds: [functionId], newVisibilityFunctionIds: both() });
  });

  it('a template records the functions of each event it creates; one without functions gets no row', async () => {
    const { apply } = await template([{ title: 'Shared item', functionIds: [otherFunctionId, functionId] }, { title: 'Bare item', functionIds: [] }]);
    const events = await apply();
    const shared = events.find(e => e.title === 'Shared item')!;
    const bare = events.find(e => e.title === 'Bare item')!;

    expect(await only(VISIBILITY, shared.id)).toEqual({ oldVisibilityFunctionIds: [], newVisibilityFunctionIds: both() });
    expect(await rowsOf(VISIBILITY, bare.id)).toHaveLength(0);
  });

  it('a clone records the functions of each copy; one without functions gets no row', async () => {
    const { withFunctions, without, clone, copyOf } = await cloneSource();
    await clone();
    const [copy, bareCopy] = await Promise.all([copyOf(withFunctions), copyOf(without)]);

    expect(await only(VISIBILITY, copy!.id)).toEqual({ oldVisibilityFunctionIds: [], newVisibilityFunctionIds: both() });
    expect(await rowsOf(VISIBILITY, bareCopy!.id)).toHaveLength(0);
  });

  it('a deletion records the functions each event had, those without functions too', async () => {
    const [single, shared, bare] = await Promise.all([eventFor([functionId]), eventFor([otherFunctionId, functionId]), eventFor([])]);
    await asAdmin().seasonCalendar.deleteMilestone({ id: single });
    await asAdmin().seasonCalendar.deleteMilestones({ ids: [shared, bare] });

    expect(await only(VISIBILITY, single)).toEqual({ oldVisibilityFunctionIds: [functionId], newVisibilityFunctionIds: [], eventDeleted: true });
    expect(await only(VISIBILITY, shared)).toEqual({ oldVisibilityFunctionIds: both(), newVisibilityFunctionIds: [], eventDeleted: true });
    expect(await only(VISIBILITY, bare)).toEqual({ oldVisibilityFunctionIds: [], newVisibilityFunctionIds: [], eventDeleted: true });
  });

  it('a deletion records the functions an update left while the deletion waited for the event', async () => {
    const id = await eventFor([functionId]);
    const outcome = await whileHeld(
      holder => holder.query('UPDATE calendar_events SET title = title WHERE id = $1', [id]),
      () => asAdmin().seasonCalendar.deleteMilestone({ id }),
      async holder => {
        await holder.query('DELETE FROM calendar_event_visibilities WHERE "eventId" = $1', [id]);
        await holder.query('INSERT INTO calendar_event_visibilities ("eventId", "functionId") VALUES ($1, $2)', [id, otherFunctionId]);
      }
    );

    expect(outcome.status).toBe('fulfilled');
    expect(await only(VISIBILITY, id)).toEqual({ oldVisibilityFunctionIds: [otherFunctionId], newVisibilityFunctionIds: [], eventDeleted: true });
  });

  describe('a change whose row cannot be written is not saved', () => {
    it('a creation', async () => {
      const title = `Refused ${randomUUID().slice(0, 8)}`;
      failAuditFor(VISIBILITY);
      await expect(create(title)).rejects.toThrow('audit store unavailable');
      expect(await prisma.calendarEvent.count({ where: { title } })).toBe(0);
    });

    it('an update', async () => {
      const id = await eventFor([functionId]);
      failAuditFor(VISIBILITY);
      await expect(asAdmin().seasonCalendar.updateMilestone({ id, expected: await expectedOf(prisma, id), data: { title: 'Refused', visibilityFunctionIds: [otherFunctionId] } })).rejects.toThrow('audit store unavailable');
      const kept = await prisma.calendarEvent.findUniqueOrThrow({ where: { id }, include: { visibilities: true } });
      expect(kept.title).not.toBe('Refused');
      expect(kept.visibilities.map(v => v.functionId)).toEqual([functionId]);
    });

    it('a deletion', async () => {
      const id = await eventFor([functionId]);
      failAuditFor(VISIBILITY);
      await expect(asAdmin().seasonCalendar.deleteMilestone({ id })).rejects.toThrow('audit store unavailable');
      expect(await prisma.calendarEvent.count({ where: { id } })).toBe(1);
    });

    it('a template', async () => {
      const { groupId, apply } = await template([{ title: 'Refused item', functionIds: [functionId] }]);
      failAuditFor(VISIBILITY);
      await expect(apply()).rejects.toThrow('audit store unavailable');
      expect(await prisma.calendarEvent.count({ where: { planningGroupId: groupId } })).toBe(0);
    });

    it('a clone', async () => {
      const { withFunctions, clone, copyOf } = await cloneSource();
      failAuditFor(VISIBILITY);
      await expect(clone()).rejects.toThrow('audit store unavailable');
      expect(await copyOf(withFunctions)).toBeNull();
    });
  });
});

describe('section access', () => {
  const SECTION = 'admin.brands';
  const KILL_SWITCH = 'app.sections.disabled';
  const DEFAULTS = 'rbac.sectionAccessDefaults';

  /** The global section settings go back to their defaults, for the specs that run after. */
  async function resetSectionConfig() {
    await prisma.appConfig.deleteMany({ where: { key: { in: [KILL_SWITCH, DEFAULTS] } } });
    invalidateRbacCache();
  }
  afterEach(resetSectionConfig);

  const viewerId = async () => (await createTestUser('viewer')).user.id as string;
  const killSwitchRows = () => prisma.auditLog.findMany({ where: { action: 'CONFIG_UPSERT', targetId: KILL_SWITCH } });

  it("a user's override records the user, the section and the value; a removal records null", async () => {
    const userId = await viewerId();
    await asAdmin().sectionAccess.set({ userId, section: SECTION, enabled: false });
    await asAdmin().sectionAccess.set({ userId, section: SECTION, enabled: null });

    const rows = await rowsOf('SECTION_ACCESS_UPDATED', `${userId}:${SECTION}`);
    expect(rows.map(r => [r.targetType, r.metadata])).toEqual([
      ['UserSectionAccess', { targetUserId: userId, section: SECTION, enabled: false }],
      ['UserSectionAccess', { targetUserId: userId, section: SECTION, enabled: null }],
    ]);
  });

  it('an override whose row cannot be written is not saved', async () => {
    const userId = await viewerId();
    failAuditFor('SECTION_ACCESS_UPDATED');
    await expect(asAdmin().sectionAccess.set({ userId, section: SECTION, enabled: false })).rejects.toThrow('audit store unavailable');
    expect(await prisma.userSectionAccess.count({ where: { userId } })).toBe(0);
  });

  it('the role defaults record the whole map', async () => {
    const sectionAccessDefaults = { viewer: { [SECTION]: 'disabled' as const } };
    await asAdmin().sectionAccess.setRoleDefaults({ sectionAccessDefaults });

    const rows = await prisma.auditLog.findMany({ where: { action: 'CONFIG_UPSERT', targetId: DEFAULTS }, orderBy: { createdAt: 'desc' }, take: 1 });
    expect(rows[0]?.metadata).toEqual({ sectionAccessDefaults });
  });

  it('role defaults whose row cannot be written are not saved', async () => {
    failAuditFor('CONFIG_UPSERT');
    await expect(asAdmin().sectionAccess.setRoleDefaults({ sectionAccessDefaults: { viewer: { [SECTION]: 'disabled' } } }))
      .rejects.toThrow('audit store unavailable');
    expect(await prisma.appConfig.count({ where: { key: DEFAULTS } })).toBe(0);
  });

  it('the kill switch records its whole value, in one row', async () => {
    // Longer than the 32 characters a redacted value keeps.
    const sectionsDisabled = ['settings.storage', SECTION];
    const before = (await killSwitchRows()).length;
    await asAdmin().config.set({ key: KILL_SWITCH, value: JSON.stringify(sectionsDisabled) });

    const rows = await killSwitchRows();
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)?.metadata).toMatchObject({ key: KILL_SWITCH, sectionsDisabled });
  });

  it('a kill switch whose row cannot be written is not saved', async () => {
    failAuditFor('CONFIG_UPSERT');
    await expect(asAdmin().config.set({ key: KILL_SWITCH, value: JSON.stringify([SECTION]) })).rejects.toThrow('audit store unavailable');
    expect(await prisma.appConfig.count({ where: { key: KILL_SWITCH } })).toBe(0);
  });

  it('deleting a key records it in the delete; an absent key records nothing', async () => {
    await prisma.appConfig.create({ data: { key: KILL_SWITCH, value: JSON.stringify([SECTION]) } });
    const before = (await rowsOf('CONFIG_DELETE', KILL_SWITCH)).length;
    await asAdmin().config.delete({ key: KILL_SWITCH });
    expect(await deleteConfig({ prisma }, KILL_SWITCH)).toBe(false);

    const rows = await rowsOf('CONFIG_DELETE', KILL_SWITCH);
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)).toMatchObject({ targetType: 'Config', metadata: { key: KILL_SWITCH } });
  });

  it('a delete whose row cannot be written is not saved', async () => {
    await prisma.appConfig.create({ data: { key: KILL_SWITCH, value: JSON.stringify([SECTION]) } });
    failAuditFor('CONFIG_DELETE');
    await expect(asAdmin().config.delete({ key: KILL_SWITCH })).rejects.toThrow('audit store unavailable');
    expect(await prisma.appConfig.count({ where: { key: KILL_SWITCH } })).toBe(1);
  });
});

describe('logAudit with a transaction', () => {
  it('a row written through the transaction rolls back with it', async () => {
    const targetId = randomUUID();

    await expect(prisma.$transaction(async tx => {
      await auditLog.logAudit({ prisma }, { action: 'USER_ACCESS_CHANGED', targetType: 'User', targetId, result: 'SUCCESS' }, { tx });
      throw new Error('rolled back');
    })).rejects.toThrow('rolled back');

    expect(await rowsOf('USER_ACCESS_CHANGED', targetId)).toHaveLength(0);
  });
});

describe('retention', () => {
  it('every access action is kept for the critical retention', () => {
    for (const action of [
      'USER_ACCESS_CHANGED',
      'COMPANY_TEAM_CREATED', 'COMPANY_TEAM_UPDATED', 'COMPANY_TEAM_DELETED',
      'COMPANY_TEAM_MEMBER_ADDED', 'COMPANY_TEAM_MEMBER_REMOVED', 'COMPANY_TEAM_MEMBER_ROLE_UPDATED',
      'CALENDAR_EVENT_USER_VISIBILITY_GRANTED', 'CALENDAR_EVENT_USER_VISIBILITY_REVOKED',
      'CALENDAR_EVENT_VISIBILITY_CHANGED',
    ]) {
      expect(CRITICAL_AUDIT_ACTIONS.has(action), action).toBe(true);
    }
  });
});
