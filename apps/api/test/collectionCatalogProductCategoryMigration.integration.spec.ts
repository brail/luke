/**
 * Migration `20261112220000_collection_catalog_product_category` (#126): merges the row category
 * spellings that differ only in case or surrounding whitespace into the most frequent one, and creates
 * one active catalog item per category, `value` = `label` = the text.
 *
 * Each test starts from an empty database (`setupTestDb` truncates every table, so the category
 * catalog is empty as on the first run in every environment), seeds rows, then runs the migration file.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { Client } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';

import { COLLECTION_STATUS } from '@luke/core';
import { PRISMA_MIGRATIONS_DIR, type PrismaClient } from '@luke/db';

import { createCalendarFixture, setupTestDb } from './helpers';

const MIGRATION = readFileSync(
  join(PRISMA_MIGRATIONS_DIR, '20261112220000_collection_catalog_product_category', 'migration.sql'),
  'utf8'
);

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

async function migrate() {
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query(MIGRATION);
  } finally {
    await client.end();
  }
}

/** One row per category given, in a fresh layout. */
async function rows(...categories: string[]) {
  const calendar = await createCalendarFixture(prisma, { prefix: 'PC' });
  const layout = await prisma.collectionLayout.create({ data: { brandId: calendar.brandId, seasonId: calendar.seasonId } });
  const group = await prisma.collectionGroup.create({ data: { collectionLayoutId: layout.id, name: 'G' } });
  await prisma.collectionLayoutRow.createMany({
    data: categories.map((productCategory, i) => ({
      collectionLayoutId: layout.id, groupId: group.id, planningGroupId: calendar.planningGroupId,
      gender: 'MAN', line: `L${i}`, status: COLLECTION_STATUS[0], productCategory,
    })),
  });
}

const rowCategories = async () =>
  (await prisma.collectionLayoutRow.findMany({ select: { productCategory: true }, orderBy: { line: 'asc' } }))
    .map(r => r.productCategory);
const items = () =>
  prisma.collectionCatalogItem.findMany({
    where: { type: 'productCategory' },
    select: { value: true, label: true, order: true, isActive: true },
    orderBy: { order: 'asc' },
  });

describe('migration collection_catalog_product_category', () => {
  it('merges spellings differing in case or surrounding whitespace into the most frequent one', async () => {
    await rows('SNEAKER', 'SNEAKER ', 'sneaker', 'SNEAKER', ' Boot', 'BOOT');
    await migrate();
    // L0..L5 in order: the SNEAKER group (4 rows) and the Boot/BOOT tie, won by upper case.
    expect(await rowCategories()).toEqual(['SNEAKER', 'SNEAKER', 'SNEAKER', 'SNEAKER', 'BOOT', 'BOOT']);
  });

  it('turns a whitespace-only category into n/a', async () => {
    await rows('   ', 'n/a');
    await migrate();
    expect(await rowCategories()).toEqual(['n/a', 'n/a']);
  });

  it('on the first run, creates one active item per category, value = label, in alphabetical order', async () => {
    await rows('URBAN', 'cupsole', 'URBAN', 'BOOT');
    await migrate();
    expect(await items()).toEqual([
      { value: 'BOOT', label: 'BOOT', order: 0, isActive: true },
      { value: 'cupsole', label: 'cupsole', order: 1, isActive: true },
      { value: 'URBAN', label: 'URBAN', order: 2, isActive: true },
    ]);
    expect(new Set(await rowCategories())).toEqual(new Set((await items()).map(i => i.value)));
  });

  it("changes nothing on a second run, keeping an admin's deactivation, label and extra item", async () => {
    await rows('URBAN', 'BOOT');
    await migrate();
    await prisma.collectionCatalogItem.update({
      where: { type_value: { type: 'productCategory', value: 'BOOT' } },
      data: { isActive: false, label: 'Stivale' },
    });
    await prisma.collectionCatalogItem.create({ data: { type: 'productCategory', value: 'MULE', label: 'Mule', order: 2 } });
    const before = { rows: await rowCategories(), items: await items() };

    await migrate();

    expect({ rows: await rowCategories(), items: await items() }).toEqual(before);
  });
});
