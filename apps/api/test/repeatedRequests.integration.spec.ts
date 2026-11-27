/**
 * A request that arrives twice, or races another one, does no harm (#248): a repeated delete answers
 * NOT_FOUND, a repeated team change tells no one again, and every maintenance transition re-checks
 * the stored state under the AppConfig write lock, so a stale read or a concurrent writer never
 * undoes another's change or announces one that did not happen.
 */

import { randomUUID } from 'crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import {
  DEFAULT_STATE,
  getMaintenanceState,
  markActivated,
  recordWarningsSent,
  writeMaintenanceState,
  type MaintenanceModeState,
} from '../src/lib/maintenanceMode';
import { runTick } from '../src/lib/maintenanceModeScheduler';

import { createCallerAs, createTestUser, setupTestDb } from './helpers';
import { holdAppConfigWriteLock, whileHeld } from './helpers/heldTransaction';

import type { FastifyInstance } from 'fastify';
import type { Client } from 'pg';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

describe('a repeated delete answers NOT_FOUND', () => {
  it('a holiday', async () => {
    await prisma.holidayCountry.upsert({ where: { code: 'XR' }, update: {}, create: { code: 'XR', name: 'Repeat' } });
    const day = new Date('2031-05-02T00:00:00.000Z');
    const holiday = await prisma.holiday.create({ data: { countryCode: 'XR', name: 'Festa', startDate: day, endDate: day } });
    const admin = await createCallerAs('admin');

    await admin.holidays.deleteHoliday({ id: holiday.id });

    await expect(admin.holidays.deleteHoliday({ id: holiday.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a template and a template item', async () => {
    const template = await prisma.milestoneTemplate.create({ data: { name: `Repeat ${randomUUID()}` } });
    const item = await prisma.milestoneTemplateItem.create({ data: { templateId: template.id, title: 'Voce', offsetDays: 0 } });
    const admin = await createCallerAs('admin');

    await admin.seasonCalendar.deleteTemplateItem({ id: item.id });
    await expect(admin.seasonCalendar.deleteTemplateItem({ id: item.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await admin.seasonCalendar.deleteTemplate({ id: template.id });
    await expect(admin.seasonCalendar.deleteTemplate({ id: template.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('team notices go to the members actually added or removed', () => {
  async function team() {
    const uid = randomUUID().substring(0, 6);
    const fn = await prisma.companyFunction.create({ data: { slug: `repeat_${uid}`, name: `Repeat ${uid}`, order: 90, isActive: true } });
    return prisma.companyTeam.create({ data: { functionId: fn.id, name: `Repeat team ${uid}` } });
  }
  const noticesOf = (userId: string) => prisma.notification.count({ where: { userId } });

  it('adding: two notices for a new member, none for a present one, none on a repeat', async () => {
    const { id: teamId } = await team();
    const present = (await createTestUser('viewer')).user;
    const added = (await createTestUser('viewer')).user;
    await prisma.companyTeamMembership.create({ data: { teamId, userId: present.id, role: 'MEMBER' } });
    const admin = await createCallerAs('admin');

    await admin.company.team.addMembers({ teamId, userIds: [present.id, added.id], role: 'MEMBER' });
    expect(await noticesOf(added.id)).toBe(2); // the team and the calendar access
    expect(await noticesOf(present.id)).toBe(0);

    await admin.company.team.addMembers({ teamId, userIds: [present.id, added.id], role: 'MEMBER' });
    expect(await noticesOf(added.id)).toBe(2);
    expect(await noticesOf(present.id)).toBe(0);
  });

  it('removing: one notice for a removed member, none for one who was not in the team', async () => {
    const { id: teamId } = await team();
    const member = (await createTestUser('viewer')).user;
    const outsider = (await createTestUser('viewer')).user;
    await prisma.companyTeamMembership.create({ data: { teamId, userId: member.id, role: 'MEMBER' } });
    const admin = await createCallerAs('admin');

    await admin.company.team.removeMembers({ teamId, userIds: [member.id, outsider.id] });
    await admin.company.team.removeMembers({ teamId, userIds: [member.id, outsider.id] });

    expect(await noticesOf(member.id)).toBe(1);
    expect(await noticesOf(outsider.id)).toBe(0);
  });
});

describe('maintenance transitions re-check the stored state under the write lock', () => {
  const SCHEDULED: MaintenanceModeState = {
    ...DEFAULT_STATE,
    status: 'SCHEDULED',
    scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    warningLeadMinutes: [15, 5],
  };
  const ACTIVE: MaintenanceModeState = { ...DEFAULT_STATE, status: 'ACTIVE', activatedAt: new Date().toISOString() };

  /** Writes `state` from the holder's own transaction, as another request or tick committing meanwhile. */
  const commitsMeanwhile = (state: MaintenanceModeState) => (holder: Client) =>
    holder.query(`UPDATE app_configs SET value = $1 WHERE key = 'maintenance.mode.state'`, [JSON.stringify(state)]);

  const auditCount = (action: string) => prisma.auditLog.count({ where: { action } });

  afterEach(async () => {
    await writeMaintenanceState(prisma, DEFAULT_STATE);
  });

  it('an end racing another end is refused, and ends nothing twice', async () => {
    await writeMaintenanceState(prisma, ACTIVE);
    const admin = await createCallerAs('admin');

    const outcome = await whileHeld(holdAppConfigWriteLock, () => admin.maintenance.mode.end(), commitsMeanwhile(DEFAULT_STATE));

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'BAD_REQUEST' } });
    expect(await auditCount('MAINTENANCE_MODE_ENDED')).toBe(0);
  });

  it('a cancel racing an activation is refused, and leaves maintenance active', async () => {
    await writeMaintenanceState(prisma, SCHEDULED);
    const admin = await createCallerAs('admin');

    const outcome = await whileHeld(holdAppConfigWriteLock, () => admin.maintenance.mode.cancelScheduled(), commitsMeanwhile(ACTIVE));

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'BAD_REQUEST' } });
    expect((await prisma.appConfig.findUniqueOrThrow({ where: { key: 'maintenance.mode.state' } })).value).toContain('"ACTIVE"');
    expect(await auditCount('MAINTENANCE_MODE_CANCELLED')).toBe(0);
  });

  it('a late activation tick does not bring back a cancelled schedule', async () => {
    await writeMaintenanceState(prisma, SCHEDULED);
    const read = await getMaintenanceState(prisma);
    await (await createCallerAs('admin')).maintenance.mode.cancelScheduled();

    await expect(markActivated(prisma, read)).resolves.toBeNull();
    expect((await prisma.appConfig.findUniqueOrThrow({ where: { key: 'maintenance.mode.state' } })).value).toContain('"INACTIVE"');
  });

  it('a late warning tick records nothing for a cancelled schedule, and one already recorded is not recorded again', async () => {
    await writeMaintenanceState(prisma, SCHEDULED);
    const read = await getMaintenanceState(prisma);

    await expect(recordWarningsSent(prisma, read, [15])).resolves.toEqual([15]);
    await expect(recordWarningsSent(prisma, read, [15])).resolves.toEqual([]);

    await (await createCallerAs('admin')).maintenance.mode.cancelScheduled();
    await expect(recordWarningsSent(prisma, read, [5])).resolves.toEqual([]);
    expect((await prisma.appConfig.findUniqueOrThrow({ where: { key: 'maintenance.mode.state' } })).value).toContain('"INACTIVE"');
  });

  it('a current schedule is activated, with what was set when it was scheduled', async () => {
    await writeMaintenanceState(prisma, { ...SCHEDULED, message: 'Aggiornamento', forceLogout: true });
    const read = await getMaintenanceState(prisma);

    await expect(markActivated(prisma, read)).resolves.toMatchObject({
      status: 'ACTIVE',
      activatedAt: expect.any(String),
      message: 'Aggiornamento',
      forceLogout: true,
    });
    expect((await prisma.appConfig.findUniqueOrThrow({ where: { key: 'maintenance.mode.state' } })).value).toContain('"ACTIVE"');
  });

  it('a late tick of a schedule since replaced neither activates nor records warnings on the new one', async () => {
    await writeMaintenanceState(prisma, SCHEDULED);
    const read = await getMaintenanceState(prisma);
    const later = { ...SCHEDULED, scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() };
    await writeMaintenanceState(prisma, later);

    await expect(markActivated(prisma, read)).resolves.toBeNull();
    await expect(recordWarningsSent(prisma, read, [15])).resolves.toEqual([]);
    const stored = JSON.parse((await prisma.appConfig.findUniqueOrThrow({ where: { key: 'maintenance.mode.state' } })).value);
    expect(stored).toMatchObject({ status: 'SCHEDULED', scheduledAt: later.scheduledAt, warningsSent: [] });
  });

  it('a schedule is refused while maintenance is active, which stays active', async () => {
    await writeMaintenanceState(prisma, ACTIVE);

    await expect(
      (await createCallerAs('admin')).maintenance.mode.schedule({
        scheduledAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        forceLogout: false,
        warningLeadMinutes: [],
        notifyByEmail: false,
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await prisma.appConfig.findUniqueOrThrow({ where: { key: 'maintenance.mode.state' } })).value).toContain('"ACTIVE"');
  });

  describe('a scheduler tick working from a stale read', () => {
    // Only the two methods a tick calls: a Fastify logger is not needed here.
    const log = { info: vi.fn(), error: vi.fn() } as unknown as FastifyInstance['log'];

    /** Primes the cache with `state`, then ends maintenance in the row only, as another request would. */
    async function staleRead(state: MaintenanceModeState) {
      await writeMaintenanceState(prisma, state);
      await prisma.appConfig.update({ where: { key: 'maintenance.mode.state' }, data: { value: JSON.stringify(DEFAULT_STATE) } });
    }

    it('does not activate a cancelled schedule, nor sign anyone out', async () => {
      const { user } = await createTestUser('viewer');
      await staleRead({ ...SCHEDULED, scheduledAt: new Date(Date.now() - 1000).toISOString(), forceLogout: true });

      await runTick(prisma, log);

      expect((await prisma.appConfig.findUniqueOrThrow({ where: { key: 'maintenance.mode.state' } })).value).toContain('"INACTIVE"');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tokenVersion).toBe(user.tokenVersion ?? 0);
    });

    it('sends no warning for a cancelled schedule', async () => {
      await createTestUser('viewer');
      await staleRead({ ...SCHEDULED, scheduledAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() });

      await runTick(prisma, log);

      expect(await prisma.notification.count({ where: { data: { path: ['type'], equals: 'maintenance_mode_warning' } } })).toBe(0);
    });
  });
});
