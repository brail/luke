/**
 * A permanent delete of a brand, season or vendor is admin-only (`*:*`). The `<resource>:delete`
 * each router used to require is the archive permission, and editor holds it through `<resource>:*`,
 * so an editor could erase master data for good. Brand is covered by the role matrix in
 * `brand.integration.spec.ts`; season and vendor have no router spec of their own.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeEach } from 'vitest';

import { HARD_DELETE_CONFIRM_PHRASE } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createCallerAs, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

const newSeason = () =>
  prisma.season.create({ data: { code: `S${randomUUID().slice(0, 6)}`, name: 'Season' } });
const newVendor = () => prisma.vendor.create({ data: { name: `Vendor ${randomUUID().slice(0, 6)}` } });

describe('season.hardDelete', () => {
  it('an editor, who can archive a season, cannot delete it for good', async () => {
    const season = await newSeason();
    const caller = await createCallerAs('editor');

    await expect(
      caller.season.hardDelete({ id: season.id, confirmPhrase: HARD_DELETE_CONFIRM_PHRASE }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await prisma.season.count({ where: { id: season.id } })).toBe(1);
  });

  it('an admin can', async () => {
    const season = await newSeason();
    const caller = await createCallerAs('admin');

    await expect(
      caller.season.hardDelete({ id: season.id, confirmPhrase: HARD_DELETE_CONFIRM_PHRASE }),
    ).resolves.toEqual({ success: true });
    expect(await prisma.season.count({ where: { id: season.id } })).toBe(0);
  });
});

describe('vendors.hardDelete', () => {
  it('an editor, who can archive a vendor, cannot delete it for good', async () => {
    const vendor = await newVendor();
    const caller = await createCallerAs('editor');

    await expect(
      caller.vendors.hardDelete({ id: vendor.id, confirmPhrase: HARD_DELETE_CONFIRM_PHRASE }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await prisma.vendor.count({ where: { id: vendor.id } })).toBe(1);
  });

  it('an admin can', async () => {
    const vendor = await newVendor();
    const caller = await createCallerAs('admin');

    await expect(
      caller.vendors.hardDelete({ id: vendor.id, confirmPhrase: HARD_DELETE_CONFIRM_PHRASE }),
    ).resolves.toEqual({ success: true });
    expect(await prisma.vendor.count({ where: { id: vendor.id } })).toBe(0);
  });
});
