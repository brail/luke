/**
 * A vendor's minimum order quantities, in pairs (#124): the colour minimum is required when a vendor
 * is created and can never be cleared, the line and model ones are optional. Vendors created by the
 * NAV sync, or before #124, have none until someone records them.
 */

import { randomUUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { rateLimitStore } from '../src/lib/ratelimit';

import { createCallerAs, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  rateLimitStore.clear();
});

const name = () => `Vendor ${randomUUID().slice(0, 6)}`;

describe('vendor minimum order quantities', () => {
  it('refuses a vendor without the colour minimum, and creates none', async () => {
    const vendors = (await createCallerAs('admin')).vendors;
    const before = await prisma.vendor.count();

    // Cast: the call deliberately leaves out the field the input type requires.
    await expect(vendors.create({ name: name() } as Parameters<typeof vendors.create>[0])).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(await prisma.vendor.count()).toBe(before);
  });

  it('stores and returns all three, also through the list', async () => {
    const vendors = (await createCallerAs('admin')).vendors;

    const created = await vendors.create({ name: name(), moqPerLine: 1200, moqPerModel: 600, moqPerColor: 300 });
    const listed = (await vendors.list({})).items.find(v => v.id === created.id);

    expect(created).toMatchObject({ moqPerLine: 1200, moqPerModel: 600, moqPerColor: 300 });
    expect(listed).toMatchObject({ moqPerLine: 1200, moqPerModel: 600, moqPerColor: 300 });
  });

  it('updates a vendor that has none without requiring them, but never clears the colour minimum', async () => {
    const vendors = (await createCallerAs('admin')).vendors;
    const synced = await prisma.vendor.create({ data: { name: name(), countryCode: 'IT' } });

    await vendors.update({ id: synced.id, data: { notes: 'Da completare' } });
    // Cast: null is outside the input type, as the API must refuse it.
    const clearing = vendors.update({ id: synced.id, data: { moqPerColor: null } as unknown as { moqPerColor: number } });

    await expect(clearing).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await prisma.vendor.findUniqueOrThrow({ where: { id: synced.id } })).toMatchObject({
      notes: 'Da completare',
      moqPerColor: null,
    });
  });
});
