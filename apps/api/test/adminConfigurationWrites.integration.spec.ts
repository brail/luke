/**
 * The collection catalog and vendor closures are configured on admin pages, so their writes take
 * `collection_layout:configure` and `season_calendar:configure`, which only admin holds: they used
 * to take the `update` editors hold for the product and planning pages. Each refusal also proves
 * nothing was written. Admin's closure writes are covered by `holidays.integration.spec.ts`.
 */

import { randomUUID } from 'crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { rateLimitStore } from '../src/lib/ratelimit';

import { createCallerAs, expectUnauthorized, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  rateLimitStore.clear();
});

const uid = () => randomUUID().slice(0, 6).toUpperCase();
const NON_ADMIN = ['editor', 'viewer'] as const;

const newCatalogItem = () =>
  prisma.collectionCatalogItem.create({ data: { type: 'strategy', value: `V${uid()}`, label: 'Strategy', order: 90 } });

/** A closure between a vendor and a season of their own. */
async function newClosure() {
  const [vendor, season] = await Promise.all([
    prisma.vendor.create({ data: { name: `Vendor ${uid()}` } }),
    prisma.season.create({ data: { code: `VC${uid()}`, name: `Season ${uid()}` } }),
  ]);
  return prisma.vendorClosurePeriod.create({
    data: {
      vendorId: vendor.id,
      seasonId: season.id,
      name: 'Ferie',
      startDate: new Date('2026-08-10'),
      endDate: new Date('2026-08-21'),
    },
  });
}

describe('collectionCatalog writes', () => {
  it.each(NON_ADMIN)('refuse %s, and nothing is written', async role => {
    const item = await newCatalogItem();
    const before = await prisma.collectionCatalogItem.count();
    const catalog = (await createCallerAs(role)).collectionCatalog;

    await expectUnauthorized(() => catalog.create({ type: 'strategy', value: `V${uid()}`, label: 'New' }));
    await expectUnauthorized(() => catalog.update({ id: item.id, data: { label: 'Renamed' } }));
    await expectUnauthorized(() => catalog.remove({ id: item.id }));
    await expectUnauthorized(() => catalog.restore({ id: item.id }));
    await expectUnauthorized(() => catalog.reorder({ type: 'strategy', orderedIds: [item.id] }));

    expect(await prisma.collectionCatalogItem.count()).toBe(before);
    expect(await prisma.collectionCatalogItem.findUniqueOrThrow({ where: { id: item.id } })).toEqual(item);
  });

  it('let admin create and rename an item', async () => {
    const catalog = (await createCallerAs('admin')).collectionCatalog;

    const created = await catalog.create({ type: 'strategy', value: `V${uid()}`, label: 'New' });
    await catalog.update({ id: created.id, data: { label: 'Renamed' } });

    expect((await prisma.collectionCatalogItem.findUniqueOrThrow({ where: { id: created.id } })).label).toBe('Renamed');
  });

  // Listing inactive items too is a read: it takes `collection_layout:read` (CLAUDE.md rule 5).
  it('listAll is readable with collection_layout:read', async () => {
    const item = await newCatalogItem();

    const items = await (await createCallerAs('viewer')).collectionCatalog.listAll({ type: 'strategy' });

    expect(items.map(i => i.id)).toContain(item.id);
  });
});

describe('vendor closure writes', () => {
  it.each(NON_ADMIN)('refuse %s, and nothing is written', async role => {
    const closure = await newClosure();
    const before = await prisma.vendorClosurePeriod.count();
    const holidays = (await createCallerAs(role)).holidays;
    const fields = {
      vendorId: closure.vendorId,
      seasonId: closure.seasonId,
      countryCode: null,
      name: 'Altro',
      type: 'CLOSURE' as const,
      startDate: '2026-09-01',
      endDate: '2026-09-05',
    };

    await expectUnauthorized(() => holidays.upsertVendorClosure(fields));
    await expectUnauthorized(() => holidays.upsertVendorClosure({ ...fields, id: closure.id }));
    await expectUnauthorized(() => holidays.deleteVendorClosure({ id: closure.id }));
    await expectUnauthorized(() => holidays.confirmVendorClosures({ ids: [closure.id] }));
    await expectUnauthorized(() =>
      holidays.prefillVendorClosures({ vendorId: closure.vendorId, seasonId: closure.seasonId, countryCodes: ['ZZ'] })
    );

    expect(await prisma.vendorClosurePeriod.count()).toBe(before);
    expect(await prisma.vendorClosurePeriod.findUniqueOrThrow({ where: { id: closure.id } })).toEqual(closure);
  });
});
