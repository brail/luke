/**
 * The zone a person reads in: their `User.timezone` when it is an IANA name, else the business
 * zone. One legacy row must never stop a batch over many users, so the fallback warns, not throws.
 */

import { describe, it, expect, vi } from 'vitest';

import { APP_CONFIG_DEFAULTS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { getUserTimeZone, groupByTimeZone, resolveUserTimeZone } from '../src/lib/userTimeZone';

import { createSilentLogger } from './helpers/logger';

/** A client whose only table is AppConfig, holding `app.defaultTimezone` when `businessZone` is set. */
function prismaWith(businessZone: string | null) {
  const findUnique = vi.fn(async () =>
    businessZone === null ? null : { key: 'app.defaultTimezone', value: businessZone, isEncrypted: false },
  );
  // Only `appConfig.findUnique` is reached: `getConfigOrDefault` reads one row.
  return { prisma: { appConfig: { findUnique } } as unknown as PrismaClient, findUnique };
}

describe('resolveUserTimeZone', () => {
  it('returns a valid stored zone without reading the business zone', async () => {
    const { prisma, findUnique } = prismaWith('Asia/Tokyo');
    await expect(resolveUserTimeZone(prisma, { id: 'u1', timezone: 'America/Los_Angeles' }, createSilentLogger()))
      .resolves.toBe('America/Los_Angeles');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each(['Mars/Olympus', '+01:00', ''])('falls back to the business zone for %j, with a warning', async timezone => {
    const { prisma } = prismaWith('Asia/Tokyo');
    const log = createSilentLogger();
    const warn = vi.spyOn(log, 'warn');
    await expect(resolveUserTimeZone(prisma, { id: 'u1', timezone }, log)).resolves.toBe('Asia/Tokyo');
    expect(warn).toHaveBeenCalledOnce();
  });

  it('returns a stored zone in the case Intl spells it', async () => {
    const { prisma } = prismaWith('Asia/Tokyo');
    await expect(resolveUserTimeZone(prisma, { id: 'u1', timezone: 'europe/rome' }, createSilentLogger())).resolves.toBe('Europe/Rome');
  });

  it('falls back to the registry default when the business zone is not configured', async () => {
    const { prisma } = prismaWith(null);
    await expect(resolveUserTimeZone(prisma, { id: 'u1', timezone: 'Mars/Olympus' }, createSilentLogger()))
      .resolves.toBe(APP_CONFIG_DEFAULTS['app.defaultTimezone']);
  });
});

describe('groupByTimeZone', () => {
  it('groups users by resolved zone, an invalid one joining the business zone', async () => {
    const { prisma } = prismaWith('Europe/Rome');
    const users = [
      { id: 'rome', timezone: 'Europe/Rome' },
      { id: 'shanghai', timezone: 'Asia/Shanghai' },
      { id: 'legacy', timezone: 'Mars/Olympus' },
      { id: 'lowercase', timezone: 'europe/rome' },
    ];
    const groups = await groupByTimeZone(prisma, users, createSilentLogger());
    expect(Object.fromEntries([...groups].map(([zone, members]) => [zone, members.map(u => u.id)]))).toEqual({
      'Europe/Rome': ['rome', 'legacy', 'lowercase'],
      'Asia/Shanghai': ['shanghai'],
    });
  });

  it('reads the business zone once, however many rows need it', async () => {
    const { prisma, findUnique } = prismaWith('Asia/Tokyo');
    const users = [{ id: 'a', timezone: 'Mars/Olympus' }, { id: 'b', timezone: '' }, { id: 'c', timezone: '+01:00' }];
    const groups = await groupByTimeZone(prisma, users, createSilentLogger());
    expect([...groups.keys()]).toEqual(['Asia/Tokyo']);
    expect(findUnique).toHaveBeenCalledOnce();
  });
});

describe('getUserTimeZone', () => {
  function prismaWithUser(timezone: string | null) {
    const { prisma } = prismaWith('Asia/Tokyo');
    // `getUserTimeZone` reads the user's row, then AppConfig only when the stored zone is unusable.
    Object.assign(prisma, { user: { findUnique: vi.fn(async () => (timezone === null ? null : { timezone })) } });
    return prisma;
  }

  it("reads the user's stored zone", async () => {
    await expect(getUserTimeZone(prismaWithUser('America/Los_Angeles'), 'u1', createSilentLogger())).resolves.toBe('America/Los_Angeles');
  });

  it('falls back to the business zone for a missing user or an invalid zone', async () => {
    await expect(getUserTimeZone(prismaWithUser(null), 'u1', createSilentLogger())).resolves.toBe('Asia/Tokyo');
    await expect(getUserTimeZone(prismaWithUser('Mars/Olympus'), 'u1', createSilentLogger())).resolves.toBe('Asia/Tokyo');
  });
});
