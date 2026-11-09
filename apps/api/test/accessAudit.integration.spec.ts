/**
 * Access changes leave their before and after in the audit trail (#222), written in the same
 * transaction as the change, and are kept for the critical retention: a user's role and active
 * state (`USER_ACCESS_CHANGED`), a team's brands and active state, its deletion with the members
 * it had, and a member's role in the team; an approval, and a per-person share of a calendar event.
 */

import { randomUUID } from 'crypto';

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import * as auditLog from '../src/lib/auditLog';
import { CRITICAL_AUDIT_ACTIONS } from '../src/lib/auditLog';

import { createCallerWithSession, createTestUser, expectToThrow, setupTestDb } from './helpers';
import { createCalendarFixture, grantBrandAccess } from './helpers/calendarFixture';

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
    eventId = (await prisma.calendarEvent.create({
      data: { calendarId: calendar.calendarId, planningGroupId: calendar.planningGroupId, title: 'Shared', startAt: new Date('2096-03-02') },
    })).id;
    // A function audience, so that neither a grant nor a revoke runs into the person-only guards.
    await prisma.calendarEventVisibility.create({ data: { eventId, functionId } });
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
    ]) {
      expect(CRITICAL_AUDIT_ACTIONS.has(action), action).toBe(true);
    }
  });
});
