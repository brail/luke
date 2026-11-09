/** The initial access snapshot (#222): every grant once, at start-up, in its creation row's shape. */

import { randomUUID } from 'crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateRbacCache } from '@luke/core/server';
import type { PrismaClient } from '@luke/db';

import { recordInitialAccessSnapshot, runInitialAccessSnapshot } from '../src/lib/accessSnapshot';
import * as auditLog from '../src/lib/auditLog';
import { auditSubjectOf, CRITICAL_AUDIT_ACTIONS, resolveAuditSubjects } from '../src/lib/auditLog';

import { createTestUser, setupTestDb } from './helpers';
import { createCalendarFixture, grantBrandAccess } from './helpers/calendarFixture';

const SNAPSHOT = 'ACCESS_SNAPSHOT';
const silent = { info: () => undefined, error: () => undefined };

let prisma: PrismaClient;

const snapshotRows = () => prisma.auditLog.findMany({ where: { action: SNAPSHOT } });

async function rowOf(targetType: string, targetId: string) {
  const rows = await prisma.auditLog.findMany({ where: { action: SNAPSHOT, targetType, targetId } });
  expect(rows, `${targetType} ${targetId}`).toHaveLength(1);
  return rows[0]!;
}

beforeAll(async () => {
  prisma = await setupTestDb();
});

/** Shared integration database: no snapshot from another spec in, none of these out. */
const clearSnapshots = () => prisma.auditLog.deleteMany({ where: { action: SNAPSHOT } });
beforeEach(clearSnapshots);
afterAll(clearSnapshots);

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.appConfig.deleteMany({ where: { key: { in: ['app.sections.disabled', 'rbac.sectionAccessDefaults'] } } });
  invalidateRbacCache();
});

describe('the initial access snapshot', () => {
  it('records every grant in the shape of its change rows, with no actor', async () => {
    const [active, inactive, pending] = await Promise.all([createTestUser('viewer'), createTestUser('editor'), createTestUser('viewer')]);
    await prisma.user.update({ where: { id: inactive.user.id }, data: { isActive: false } });
    await prisma.user.update({ where: { id: pending.user.id }, data: { pendingApproval: true } });

    const calendar = await createCalendarFixture(prisma, { prefix: 'SNP' });
    const otherBrand = await prisma.brand.create({ data: { code: `SNX${calendar.uid}`, name: 'Snapshot other', isActive: true } });
    const { functionId, teamId } = await grantBrandAccess(prisma, { brandIds: [otherBrand.id, calendar.brandId], userIds: [active.user.id], label: 'Snapshot' });
    await prisma.companyTeamMembership.update({ where: { teamId_userId: { teamId, userId: active.user.id } }, data: { role: 'LEADER' } });
    const inactiveTeam = await prisma.companyTeam.create({ data: { functionId, name: `Inactive ${randomUUID().slice(0, 6)}`, isActive: false } });

    const event = await prisma.calendarEvent.create({
      data: {
        calendarId: calendar.calendarId, planningGroupId: calendar.planningGroupId, title: 'Snapshot', startAt: new Date('2096-03-02'),
        visibilities: { create: [{ functionId }] },
        userVisibilities: { create: [{ userId: active.user.id, grantedBy: active.user.id }] },
      },
    });
    await prisma.userSectionAccess.create({ data: { userId: active.user.id, section: 'admin.brands', enabled: false } });
    await prisma.appConfig.create({ data: { key: 'app.sections.disabled', value: '["settings.storage"]' } });
    invalidateRbacCache();

    await recordInitialAccessSnapshot(prisma, silent);

    for (const [user, role, isActive, pendingApproval] of [
      [active, 'viewer', true, false], [inactive, 'editor', false, false], [pending, 'viewer', true, true],
    ] as const) {
      expect((await rowOf('User', user.user.id)).metadata).toEqual({ newRole: role, newIsActive: isActive, newPendingApproval: pendingApproval });
    }
    const team = await prisma.companyTeam.findUniqueOrThrow({ where: { id: teamId } });
    expect((await rowOf('CompanyTeam', teamId)).metadata).toEqual({ name: team.name, functionId, brandIds: [otherBrand.id, calendar.brandId].sort(), isActive: true });
    expect((await rowOf('CompanyTeam', inactiveTeam.id)).metadata).toEqual({ name: inactiveTeam.name, functionId, brandIds: [], isActive: false });
    expect((await rowOf('CompanyTeamMembership', `${teamId}:${active.user.id}`)).metadata).toEqual({ teamId, userId: active.user.id, role: 'LEADER' });
    expect((await rowOf('CalendarEventUserVisibility', `${event.id}:${active.user.id}`)).metadata).toEqual({ eventId: event.id, userId: active.user.id });
    expect((await rowOf('CalendarEvent', event.id)).metadata).toEqual({ oldVisibilityFunctionIds: [], newVisibilityFunctionIds: [functionId] });
    expect((await rowOf('UserSectionAccess', `${active.user.id}:admin.brands`)).metadata)
      .toEqual({ targetUserId: active.user.id, section: 'admin.brands', enabled: false });
    expect((await rowOf('Config', 'app.sections.disabled')).metadata).toEqual({ sectionsDisabled: ['settings.storage'] });
    // The defaults as the application reads them: the static table, with no stored override here.
    const defaults = (await rowOf('Config', 'rbac.sectionAccessDefaults')).metadata as { sectionAccessDefaults: Record<string, Record<string, string>> };
    expect(defaults.sectionAccessDefaults.viewer?.['admin.brands']).toBeDefined();

    const rows = await snapshotRows();
    expect(rows.every(r => r.actorId === null)).toBe(true);
    expect(new Set(rows.map(r => r.createdAt.getTime())).size).toBe(1);
  });

  it('is written once: a second call writes nothing, and two concurrent calls write one snapshot', async () => {
    await Promise.all([recordInitialAccessSnapshot(prisma, silent), recordInitialAccessSnapshot(prisma, silent)]);
    const first = (await snapshotRows()).length;
    expect(first).toBeGreaterThan(0);
    expect(await prisma.auditLog.count({ where: { action: SNAPSHOT, targetType: 'Config', targetId: 'app.sections.disabled' } })).toBe(1);

    await recordInitialAccessSnapshot(prisma, silent);
    expect((await snapshotRows()).length).toBe(first);
  });

  it('leaves no row when it fails after writing, and the next call writes the whole snapshot', async () => {
    // The rows are written, then the transaction fails: they must roll back with it.
    const realMany = auditLog.logAuditMany;
    vi.spyOn(auditLog, 'logAuditMany').mockImplementationOnce(async (...args) => {
      await realMany(...args);
      throw new Error('audit store unavailable');
    });
    await expect(recordInitialAccessSnapshot(prisma, silent)).rejects.toThrow('audit store unavailable');
    expect(await snapshotRows()).toHaveLength(0);

    await recordInitialAccessSnapshot(prisma, silent);
    expect((await snapshotRows()).length).toBeGreaterThan(0);
  });

  it('at start-up, a failure is logged and does not stop the server', async () => {
    vi.spyOn(auditLog, 'logAuditMany').mockRejectedValueOnce(new Error('audit store unavailable'));
    const error = vi.fn();

    await expect(runInitialAccessSnapshot(prisma, { info: () => undefined, error })).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledWith(expect.objectContaining({ err: expect.any(Error) }), 'Initial access snapshot failed');
  });

  it('is kept for the critical retention', () => {
    expect(CRITICAL_AUDIT_ACTIONS.has(SNAPSHOT)).toBe(true);
  });

  it("a user's snapshot row is not shown as that user's own action", async () => {
    const { user } = await createTestUser('viewer');
    await recordInitialAccessSnapshot(prisma, silent);

    const row = await rowOf('User', user.id);
    // Even on a page where another row resolves the same user.
    const subjects = await resolveAuditSubjects(prisma, [row, { ...row, action: 'AUTH_LOGIN', targetType: 'Auth' }]);
    expect(auditSubjectOf(row, subjects)).toEqual({ name: null, email: null });
  });
});
