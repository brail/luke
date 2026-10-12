/**
 * NAV's blank date `1753-01-01` (#119): the helper the season sync stores through, and the live
 * season preview, which sends NAV's days as `YYYY-MM-DD` and empties a blank or unsupported one.
 * The helper is tested here because `@luke/nav` has no test runner of its own.
 */

import { describe, expect, it, vi } from 'vitest';

import { navDateOrNull } from '@luke/nav';

import { navRouter } from '../src/routers/integrations.nav.router';

import { createSilentLogger } from './helpers/logger';

import type { Context } from '../src/lib/trpc';

const nav = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('@luke/nav', async importOriginal => ({
  ...(await importOriginal<typeof import('@luke/nav')>()),
  getNavDbConfig: vi.fn(async () => ({ company: 'C' })),
  getPool: vi.fn(async () => ({})),
  createSyncRequest: () => ({ query: async () => ({ recordset: nav.rows }) }),
}));
vi.mock('../src/lib/tokenVersionCache', () => ({ verifyTokenVersion: async () => true }));

describe('navDateOrNull', () => {
  it("reads NAV's blank date and a missing value as null", () => {
    expect(navDateOrNull(new Date('1753-01-01T00:00:00Z'))).toBeNull();
    expect(navDateOrNull(null)).toBeNull();
    expect(navDateOrNull(undefined)).toBeNull();
  });

  it('keeps every other date as it is', () => {
    const date = new Date('2026-02-01T00:00:00Z');
    expect(navDateOrNull(date)).toBe(date);
    expect(navDateOrNull(new Date('1753-01-02T00:00:00Z'))).toEqual(new Date('1753-01-02T00:00:00Z'));
  });
});

describe('integrations.nav.sync.preview — seasons', () => {
  // Only what the admin path reads: `*:*` needs no database, and an admin bypasses maintenance.
  const ctx = {
    prisma: {},
    session: { user: { id: 'u1', role: 'admin', email: 'admin@example.com', username: 'admin', tokenVersion: 0 } },
    req: { log: createSilentLogger() },
    res: {},
    traceId: 't',
    logger: createSilentLogger(),
  } as unknown as Context; // a hand-built context: the stubs above stand in for the database

  it("sends NAV's days as calendar dates and a blank or unsupported one as null", async () => {
    nav.rows = [
      { 'Code': 'S26', 'Description': 'Estate 2026', 'Starting Date': new Date('2026-02-01T00:00:00Z'), 'Ending Date': new Date('1753-01-01T00:00:00Z') },
      // Outside 1900-01-01…9999-12-30: `calendarDateOf` would throw on the first, pass the second unchecked.
      { 'Code': 'X', 'Description': null, 'Starting Date': new Date('1899-12-31T00:00:00Z'), 'Ending Date': new Date('9999-12-31T00:00:00Z') },
    ];

    const rows = await navRouter.createCaller(ctx).sync.preview({ entity: 'season' });

    expect(rows.map(({ navNo, startingDate, endingDate, city }) => ({ navNo, startingDate, endingDate, city }))).toEqual([
      { navNo: 'S26', startingDate: '2026-02-01', endingDate: null, city: null },
      { navNo: 'X', startingDate: null, endingDate: null, city: null },
    ]);
  });
});
