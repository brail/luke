/**
 * A permanent delete of a brand, season or vendor is admin-only (`*:*`). The `<resource>:delete`
 * each router used to require is the archive permission, so whoever could archive could erase
 * master data for good. No non-admin role holds that permission any more, so each refusal below
 * grants it to the editor for one test: dropping the guard back to `<resource>:delete` must fail
 * here.
 */

import { randomUUID } from 'crypto';

import { describe, it, expect, beforeEach } from 'vitest';

import { HARD_DELETE_CONFIRM_PHRASE } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createCallerAs, grantEditor, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

const newBrand = () =>
  prisma.brand.create({ data: { code: `B${randomUUID().slice(0, 6)}`, name: 'Brand' } });
const newSeason = () =>
  prisma.season.create({ data: { code: `S${randomUUID().slice(0, 6)}`, name: 'Season' } });
const newVendor = () => prisma.vendor.create({ data: { name: `Vendor ${randomUUID().slice(0, 6)}` } });

describe('brand.hardDelete', () => {
  it('a caller who can archive a brand cannot delete it for good', async () => {
    grantEditor('brands:delete');
    const brand = await newBrand();
    const caller = await createCallerAs('editor');

    await expect(
      caller.brand.hardDelete({ id: brand.id, confirmPhrase: HARD_DELETE_CONFIRM_PHRASE }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await prisma.brand.count({ where: { id: brand.id } })).toBe(1);
  });
});

describe('season.hardDelete', () => {
  it('a caller who can archive a season cannot delete it for good', async () => {
    grantEditor('seasons:delete');
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
  it('a caller who can archive a vendor cannot delete it for good', async () => {
    grantEditor('vendors:delete');
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
