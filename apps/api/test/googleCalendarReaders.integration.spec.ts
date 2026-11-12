/**
 * Who can read a function's Google calendar, and how that list follows Luke.
 *
 * Each (season calendar, function) pair has its own Google calendar. Its readers are the active
 * admins plus the active members of an active team that holds both the function and the season
 * calendar's brand; a user pending approval reads nothing. `reconcileGoogleReaders` brings every
 * provisioned calendar back to that list, so a change in Luke (a member leaving, a team losing a
 * brand, a deactivation, a new address) reaches Google on the next pass. It runs whenever Google
 * credentials exist, even with event sync turned off: turning sync off must not freeze access.
 *
 * Google itself is mocked: spied on the package namespace, as in `googleOAuthExchange`.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';

import * as calendar from '@luke/calendar';
import type { PrismaClient } from '@luke/db';

import { deleteConfig, getConfigOrDefault, saveConfig } from '../src/lib/configManager';
import {
  buildSyncContext,
  deleteGoogleCalendars,
  reconcileGoogleReaders,
} from '../src/services/googleCalendarSync.service';

import { createTestUser, setupTestDb } from './helpers';
import { grantBrandAccess } from './helpers/calendarFixture';

let prisma: PrismaClient;

let brandB: string;
let seasonCalendarB: string;
let fnF: string;
let fnG: string;
let teamFB: string;
let member: { id: string; email: string };
let admin: { id: string; email: string };
let bindingFB: string;

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const noChange: calendar.AclSyncResult = { added: 0, removed: 0, inserted: [], errors: [], unmanaged: [] };

let syncReaders: MockInstance<typeof calendar.syncCalendarAcl>;

/** The reader list the last pass sent to Google for `googleCalendarId`, sorted. */
function readersSentTo(googleCalendarId: string): string[] {
  const call = syncReaders.mock.calls.filter(([id]) => id === googleCalendarId).at(-1);
  if (!call) throw new Error(`no reader list sent to ${googleCalendarId}`);
  return [...call[1]].sort();
}

async function user(role: 'admin' | 'viewer') {
  const { user: row } = await createTestUser(role);
  return { id: row.id as string, email: row.email as string };
}

beforeEach(async () => {
  prisma = await setupTestDb();
  // Credentials only: `integrations.google.calendarSync.enabled` keeps its default, off.
  await saveConfig(prisma, 'integrations.google.domain', 'example.com');
  await saveConfig(prisma, 'integrations.google.serviceEmail', 'luke@example.com');
  await saveConfig(prisma, 'integrations.google.serviceKey', 'not-a-real-key', true);

  syncReaders = vi.spyOn(calendar, 'syncCalendarAcl').mockResolvedValue(noChange);

  const [brandRowB, brandRowC, seasonRow, fnRowF, fnRowG] = await Promise.all([
    prisma.brand.create({ data: { code: 'GRB', name: 'Readers B', isActive: true } }),
    prisma.brand.create({ data: { code: 'GRC', name: 'Readers C', isActive: true } }),
    prisma.season.create({ data: { code: 'GRS', name: 'Readers season', year: 2097, isActive: true } }),
    prisma.companyFunction.create({ data: { slug: 'readers_f', name: 'Readers F', order: 90, isActive: true } }),
    prisma.companyFunction.create({ data: { slug: 'readers_g', name: 'Readers G', order: 91, isActive: true } }),
  ]);
  brandB = brandRowB.id;
  fnF = fnRowF.id;
  fnG = fnRowG.id;
  seasonCalendarB = (await prisma.seasonCalendar.create({ data: { brandId: brandB, seasonId: seasonRow.id } })).id;

  const [m, a, crossTeams, pending, inactive, inactiveTeamMember, pendingAdmin] = await Promise.all([
    user('viewer'), user('admin'), user('viewer'), user('viewer'), user('viewer'), user('viewer'), user('admin'),
  ]);
  member = m;
  admin = a;

  teamFB = (await grantBrandAccess(prisma, {
    functionId: fnF, brandIds: [brandB], userIds: [member.id, pending.id, inactive.id], label: 'F/B',
  })).teamId;
  // The function from one team, the brand from another: neither team gives both.
  await grantBrandAccess(prisma, { functionId: fnF, brandIds: [brandRowC.id], userIds: [crossTeams.id], label: 'F/C' });
  await grantBrandAccess(prisma, { functionId: fnRowG.id, brandIds: [brandB], userIds: [crossTeams.id], label: 'G/B' });
  const { teamId: offTeam } = await grantBrandAccess(prisma, {
    functionId: fnF, brandIds: [brandB], userIds: [inactiveTeamMember.id], label: 'F/B off',
  });

  await Promise.all([
    prisma.companyTeam.update({ where: { id: offTeam }, data: { isActive: false } }),
    prisma.user.update({ where: { id: pending.id }, data: { pendingApproval: true } }),
    prisma.user.update({ where: { id: pendingAdmin.id }, data: { pendingApproval: true } }),
    prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } }),
  ]);

  bindingFB = (await prisma.googleCalendarBinding.create({
    data: { seasonCalendarId: seasonCalendarB, companyFunctionId: fnF, googleCalendarId: 'gcal-FB', isProvisioned: true },
  })).id;
});

afterEach(() => {
  vi.restoreAllMocks();
  logger.info.mockClear();
  logger.warn.mockClear();
  logger.error.mockClear();
});

describe('reader list', () => {
  it('grants a calendar only to admins and members of a team holding both its function and its brand', async () => {
    expect(await getConfigOrDefault(prisma, 'integrations.google.calendarSync.enabled')).toBe(false);

    await reconcileGoogleReaders(prisma, logger);

    expect(readersSentTo('gcal-FB')).toEqual([admin.email, member.email].sort());
  });

  it('does nothing without Google credentials', async () => {
    await deleteConfig({ prisma }, 'integrations.google.serviceKey');

    expect(await reconcileGoogleReaders(prisma, logger)).toBeNull();
    expect(syncReaders).not.toHaveBeenCalled();
  });
});

describe('access follows Luke', () => {
  it.each([
    ['leaves the team', () => prisma.companyTeamMembership.delete({ where: { teamId_userId: { teamId: teamFB, userId: member.id } } })],
    ['loses the brand with its team', () => prisma.companyTeamBrandScope.delete({ where: { teamId_brandId: { teamId: teamFB, brandId: brandB } } })],
    ['loses its team to a deactivation', () => prisma.companyTeam.update({ where: { id: teamFB }, data: { isActive: false } })],
    ['is deactivated', () => prisma.user.update({ where: { id: member.id }, data: { isActive: false } })],
  ])('revokes a member who %s', async (_label, change) => {
    await reconcileGoogleReaders(prisma, logger);
    expect(readersSentTo('gcal-FB')).toContain(member.email);

    await change();
    await reconcileGoogleReaders(prisma, logger);

    expect(readersSentTo('gcal-FB')).toEqual([admin.email]);
  });

  it('moves access to a changed address', async () => {
    await prisma.user.update({ where: { id: member.id }, data: { email: 'moved@test.com' } });

    await reconcileGoogleReaders(prisma, logger);

    expect(readersSentTo('gcal-FB')).toEqual([admin.email, 'moved@test.com'].sort());
  });

  it('adds a member who joins later', async () => {
    const late = await user('viewer');
    await prisma.companyTeamMembership.create({ data: { teamId: teamFB, userId: late.id } });

    await reconcileGoogleReaders(prisma, logger);

    expect(readersSentTo('gcal-FB')).toContain(late.email);
  });

  it('provisions a new calendar with the same rule', async () => {
    const { functionId: fnH } = await grantBrandAccess(prisma, { brandIds: [brandB], userIds: [member.id], label: 'H/B' });
    vi.spyOn(calendar, 'createCalendar').mockResolvedValue({ id: 'gcal-new', summary: 'x' });

    const ctx = await buildSyncContext(seasonCalendarB, prisma);
    const binding = await ctx.getOrCreateBinding(fnH);

    expect(binding).toMatchObject({ googleCalendarId: 'gcal-new', isProvisioned: true });
    expect(readersSentTo('gcal-new')).toEqual([admin.email, member.email].sort());
  });
});

describe('failures', () => {
  it('one failing calendar does not stop the others', async () => {
    await prisma.googleCalendarBinding.create({
      data: { seasonCalendarId: seasonCalendarB, companyFunctionId: fnG, googleCalendarId: 'gcal-GB', isProvisioned: true },
    });
    syncReaders.mockImplementation(async id => {
      if (id === 'gcal-FB') throw Object.assign(new Error('boom'), { code: 500 });
      return noChange;
    });

    const result = await reconcileGoogleReaders(prisma, logger);

    expect(readersSentTo('gcal-GB')).toBeDefined();
    expect(result).toMatchObject({ calendars: 2, failed: 1 });
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ bindingId: bindingFB }), expect.any(String));
  });

  it('a new calendar whose ACL cannot be reconciled is deleted, not bound', async () => {
    const { functionId: fnH } = await grantBrandAccess(prisma, { brandIds: [brandB], userIds: [member.id], label: 'H/B' });
    const refused = Object.assign(new Error('domain rule not pinned'), { code: 400 });
    vi.spyOn(calendar, 'createCalendar').mockResolvedValue({ id: 'gcal-new', summary: 'x' });
    vi.spyOn(calendar, 'deleteCalendar').mockResolvedValue(undefined);
    syncReaders.mockRejectedValue(refused);

    const ctx = await buildSyncContext(seasonCalendarB, prisma);

    await expect(ctx.getOrCreateBinding(fnH)).rejects.toBe(refused);
    expect(calendar.deleteCalendar).toHaveBeenCalledWith('gcal-new');
    expect(await prisma.googleCalendarBinding.count({ where: { companyFunctionId: fnH } })).toBe(0);
  });

  it('a calendar deleted in Google is one warning, not an error on every pass', async () => {
    syncReaders.mockRejectedValue(Object.assign(new Error('Not Found'), { code: 404 }));

    await reconcileGoogleReaders(prisma, logger);
    await reconcileGoogleReaders(prisma, logger);

    expect(logger.error).not.toHaveBeenCalled();
    const missing = logger.warn.mock.calls.filter(([fields]) => (fields as { bindingId?: string }).bindingId === bindingFB);
    expect(missing).toHaveLength(1);
  });

  it('reports rules Luke does not manage once while they stay the same', async () => {
    syncReaders.mockResolvedValue({ ...noChange, unmanaged: [{ role: 'writer', scopeType: 'group' }] });

    await reconcileGoogleReaders(prisma, logger);
    await reconcileGoogleReaders(prisma, logger);

    const reports = logger.warn.mock.calls.filter(([fields]) => 'unmanagedRules' in (fields as object));
    expect(reports).toHaveLength(1);
    expect(reports[0][0]).toEqual({ unmanagedRules: { 'writer/group': 1 } });
  });
});

describe('deleteGoogleCalendars', () => {
  it('deletes with event sync off and names the calendars Google refused', async () => {
    vi.spyOn(calendar, 'deleteCalendar').mockImplementation(async id => {
      if (id === 'gcal-refused') throw new Error('refused');
    });

    await deleteGoogleCalendars(['gcal-gone', 'gcal-refused'], prisma, logger);

    expect(calendar.deleteCalendar).toHaveBeenCalledWith('gcal-gone');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ failedIds: ['gcal-refused'] }),
      expect.any(String),
    );
  });
});
