import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { syncBrands } from '../brands.js';
import { syncSeasons } from '../seasons.js';
import { syncVendors } from '../vendors.js';

import type { NavDbConfig } from '../../config.js';
import type mssql from 'mssql';
import type { Logger } from 'pino';

// The sync rules of CLAUDE.md, "NAV / packages/nav": the sync writes only the fields that come from
// NAV, never `isActive` or enriched fields, so a soft-deleted entity is never reactivated; a local
// entity with the same code and no NAV link is never auto-created; one failing row stops no other.

const config = { company: 'ACME' } as NavDbConfig; // Only the company is read by the sync.
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger; // Only what the sync calls.
const ALL = { mode: 'all', navNos: [], active: true };

/** A pool whose one query returns `rows`, recording the SQL and the bound inputs. */
function fakePool(rows: Record<string, unknown>[]) {
  const queries: string[] = [];
  const inputs: unknown[][] = [];
  const pool = {
    request: () => ({
      input: (...args: unknown[]) => inputs.push(args),
      query: async (sql: string) => {
        queries.push(sql);
        return { recordset: rows };
      },
    }),
  } as unknown as mssql.ConnectionPool; // Only `request()`, with `input` and `query`.
  return { pool, queries, inputs };
}

/** A Prisma client whose transactions run on `tx`; `extra` adds what one sync reads outside them. */
function fakePrisma(
  filter: object | null,
  tx: Record<string, Record<string, ReturnType<typeof vi.fn>>>,
  extra: Record<string, unknown> = {}
) {
  return {
    navSyncFilter: { findUnique: vi.fn(async () => filter) },
    $transaction: vi.fn(async (fn: (client: unknown) => Promise<unknown>) => fn(tx)),
    ...extra,
  } as unknown as PrismaClient; // Only the delegates the sync under test reaches.
}

function brandTx(localConflictCodes: string[] = [], failingCodes: string[] = []) {
  return {
    navBrand: { upsert: vi.fn(async () => ({})) },
    brand: {
      findFirst: vi.fn(async ({ where }: { where: { code: string } }) =>
        localConflictCodes.includes(where.code) ? { id: 'local' } : null
      ),
      upsert: vi.fn(async ({ where }: { where: { navBrandId: string } }) => {
        if (failingCodes.includes(where.navBrandId)) throw new Error('value too long for type character varying(20)');
        return {};
      }),
    },
  };
}

describe('syncBrands', () => {
  it('updates only the name of a local brand, never isActive or enriched fields', async () => {
    const tx = brandTx();
    const { pool, queries } = fakePool([{ Code: 'B1', Description: 'Brand One' }]);

    const result = await syncBrands(pool, fakePrisma(ALL, tx), config, logger);

    expect(result).toEqual({ entity: 'brand', upserted: 1, skipped: false, filterMode: 'all' });
    expect(queries[0]).toContain('FROM [ACME$Brand]');
    expect(tx.brand.upsert).toHaveBeenCalledWith({
      where: { navBrandId: 'B1' },
      create: { code: 'B1', name: 'Brand One', navBrandId: 'B1', isActive: true },
      update: { name: 'Brand One' },
    });
  });

  it('never auto-creates a brand whose code exists locally without a NAV link', async () => {
    const tx = brandTx(['B1']);
    const { pool } = fakePool([{ Code: 'B1', Description: 'Brand One' }]);

    await syncBrands(pool, fakePrisma(ALL, tx), config, logger);

    expect(tx.navBrand.upsert).toHaveBeenCalled();
    expect(tx.brand.upsert).not.toHaveBeenCalled();
  });

  it('counts a failing row and still writes the others', async () => {
    const tx = brandTx([], ['TOO-LONG-CODE-FOR-THE-COLUMN']);
    const { pool } = fakePool([
      { Code: 'TOO-LONG-CODE-FOR-THE-COLUMN', Description: 'x' },
      { Code: 'B2', Description: 'Brand Two' },
    ]);

    const result = await syncBrands(pool, fakePrisma(ALL, tx), config, logger);

    expect(result.upserted).toBe(1);
    expect(tx.brand.upsert).toHaveBeenCalledTimes(2);
  });

  it('queries nothing when the entity is disabled', async () => {
    const { pool, queries } = fakePool([]);
    const result = await syncBrands(pool, fakePrisma({ ...ALL, active: false }, brandTx()), config, logger);
    expect(result).toEqual({ entity: 'brand', upserted: 0, skipped: true, filterMode: 'disabled' });
    expect(queries).toEqual([]);
  });
});

describe('syncSeasons', () => {
  it("updates only the name, and stores NAV's blank dates as null in the replica", async () => {
    const tx = {
      navSeason: { upsert: vi.fn(async () => ({})) },
      season: { findFirst: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
    };
    const ending = new Date(Date.UTC(2027, 1, 28));
    const { pool } = fakePool([
      { Code: 'FW27', Description: 'Fall 2027', 'Starting Date': new Date(Date.UTC(1753, 0, 1)), 'Ending Date': ending },
    ]);

    await syncSeasons(pool, fakePrisma(ALL, tx), config, logger);

    expect(tx.navSeason.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ update: expect.objectContaining({ startingDate: null, endingDate: ending }) })
    );
    expect(tx.season.upsert).toHaveBeenCalledWith({
      where: { navSeasonId: 'FW27' },
      create: { code: 'FW27', name: 'Fall 2027', navSeasonId: 'FW27', isActive: true },
      update: { name: 'Fall 2027' },
    });
  });
});

describe('syncVendors', () => {
  const row = { No_: 'V1', Name: 'Vendor One', 'Country_Region Code': 'IT' };

  function vendorPrisma(filter: object, lastModified: Date | null) {
    const tx = { navVendor: { upsert: vi.fn(async () => ({})) }, vendor: { upsert: vi.fn(async () => ({})) } };
    const aggregate = vi.fn(async () => ({ _max: { navLastModified: lastModified } }));
    return { tx, aggregate, prisma: fakePrisma(filter, tx, { navVendor: { aggregate } }) };
  }

  it('updates only name and country of a local vendor, never isActive or enriched fields', async () => {
    const { tx, prisma } = vendorPrisma(ALL, null);
    await syncVendors(fakePool([row]).pool, prisma, config, logger);
    expect(tx.vendor.upsert).toHaveBeenCalledWith({
      where: { navVendorId: 'V1' },
      create: { name: 'Vendor One', countryCode: 'IT', navVendorId: 'V1', isActive: true },
      update: { name: 'Vendor One', countryCode: 'IT' },
    });
  });

  it('reads only rows changed since the last sync, or with no modification date', async () => {
    const last = new Date(Date.UTC(2026, 10, 1));
    const { prisma } = vendorPrisma(ALL, last);
    const { pool, queries, inputs } = fakePool([]);

    await syncVendors(pool, prisma, config, logger);

    expect(queries[0]).toContain('([Last Date Modified] > @lastModified OR [Last Date Modified] IS NULL)');
    expect(inputs).toContainEqual(['lastModified', last]);
  });

  it('reads the whole selection in whitelist mode, ignoring the watermark', async () => {
    const { prisma, aggregate } = vendorPrisma({ mode: 'whitelist', navNos: ['V1'], active: true }, new Date());
    const { pool, queries } = fakePool([]);

    await syncVendors(pool, prisma, config, logger);

    expect(aggregate).not.toHaveBeenCalled();
    expect(queries[0]).not.toContain('@lastModified');
    expect(queries[0]).toContain('[No_] IN (@wl0)');
  });
});
