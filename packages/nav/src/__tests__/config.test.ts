import { describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { getNavDbConfig, NavConfigIncompleteError, sanitizeCompany } from '../config.js';

import type { GetConfigFn } from '../config.js';

describe('sanitizeCompany', () => {
  it('keeps a name made of letters, digits, spaces and _ - .', () => {
    expect(sanitizeCompany('ACME S.p.A. - Retail_2')).toBe('ACME S.p.A. - Retail_2');
  });

  it.each([']', '[', ';', "'", '$', '"', '', 'A]; DROP TABLE x--'])('refuses %j', company => {
    expect(() => sanitizeCompany(company)).toThrow('Invalid NAV company name');
  });
});

describe('getNavDbConfig', () => {
  const prisma = {} as PrismaClient; // Never touched: the fake getConfig ignores it.
  const complete: Record<string, string> = {
    'integrations.nav.host': 'nav.local',
    'integrations.nav.port': '1433',
    'integrations.nav.database': 'NAVDB',
    'integrations.nav.user': 'reader',
    'integrations.nav.password': 'secret',
    'integrations.nav.company': 'ACME',
  };
  const from =
    (values: Record<string, string | undefined>): GetConfigFn =>
    async (_prisma, key) =>
      values[key] ?? null;

  it('reads every key', async () => {
    await expect(getNavDbConfig(prisma, from(complete))).resolves.toEqual({
      host: 'nav.local',
      port: 1433,
      database: 'NAVDB',
      user: 'reader',
      password: 'secret',
      company: 'ACME',
      readOnly: true,
    });
  });

  it.each(['host', 'database', 'user', 'password', 'company'])('refuses a missing %s', async key => {
    const error = await getNavDbConfig(prisma, from({ ...complete, [`integrations.nav.${key}`]: undefined })).catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(NavConfigIncompleteError);
    expect(error).toMatchObject({ invalidPort: false });
  });

  it('refuses a stored port that fails its schema, never replacing it', async () => {
    const error = await getNavDbConfig(prisma, from({ ...complete, 'integrations.nav.port': 'abc' })).catch(
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(NavConfigIncompleteError);
    expect(error).toMatchObject({ invalidPort: true });
  });

  it('reads the declared default port when none is stored', async () => {
    const config = await getNavDbConfig(prisma, from({ ...complete, 'integrations.nav.port': undefined }));
    expect(config.port).toBe(1433);
  });

  it.each([
    [undefined, true],
    ['true', true],
    ['false', false],
  ])('readOnly %j reads as %j', async (stored, expected) => {
    const config = await getNavDbConfig(prisma, from({ ...complete, 'integrations.nav.readOnly': stored }));
    expect(config.readOnly).toBe(expected);
  });
});
