/**
 * Copy from season with a row selection: the copy dialog sends the rows to bring over and, for
 * each, whether its quotations come too. A selected id outside the source used to be skipped in
 * silence — a partial or empty layout reported as copied, after which a retry met CONFLICT.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import { COLLECTION_STATUS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;
let asAdmin: ReturnType<typeof createCallerWithSession>;
let brandId: string;
let sourceSeasonId: string;
const rowIds: string[] = [];

/** A fresh target season for each copy: the copy creates the target layout. */
async function newSeason(): Promise<string> {
  const uid = randomUUID().substring(0, 6).toUpperCase();
  const season = await prisma.season.create({
    data: { code: `T${uid}`, name: `Target ${uid}`, year: 2032, isActive: true },
  });
  return season.id;
}

function copyTo(toSeasonId: string, rows: { id: string; copyQuotations: boolean }[]) {
  return asAdmin.collectionLayout.copyFromSeason({
    fromBrandId: brandId,
    fromSeasonId: sourceSeasonId,
    toBrandId: brandId,
    toSeasonId,
    rows,
  });
}

function targetLayout(seasonId: string) {
  return prisma.collectionLayout.findUnique({ where: { brandId_seasonId: { brandId, seasonId } } });
}

beforeAll(async () => {
  prisma = await setupTestDb();
  const uid = randomUUID().substring(0, 6).toUpperCase();
  const admin = await createTestUser('admin');
  asAdmin = createCallerWithSession(admin.session);

  const brand = await prisma.brand.create({
    data: { code: `CP${uid}`, name: `Copy ${uid}`, isActive: true },
  });
  brandId = brand.id;
  sourceSeasonId = await newSeason();

  const layout = await asAdmin.collectionLayout.getOrCreate({
    brandId,
    seasonId: sourceSeasonId,
    availableGenders: ['MAN'],
  });
  const group = await asAdmin.collectionLayout.groups.create({
    collectionLayoutId: layout.id,
    data: { name: 'Borse', order: 0 },
  });
  for (const line of ['Tote', 'Clutch', 'Zaino']) {
    const row = await asAdmin.collectionLayout.rows.create({
      groupId: group.id,
      gender: 'MAN',
      line,
      status: COLLECTION_STATUS[0],
      productCategory: 'TEST',
      skuForecast: null,
      qtyForecast: null,
    });
    await asAdmin.collectionLayout.quotations.create({ rowId: row.id });
    rowIds.push(row.id);
  }
});

describe('collectionLayout.copyFromSeason — row selection', () => {
  it('copies only the rows chosen, with quotations only where asked', async () => {
    const target = await newSeason();
    const copy = await copyTo(target, [
      { id: rowIds[0], copyQuotations: false },
      { id: rowIds[2], copyQuotations: true },
    ]);

    const rows = await prisma.collectionLayoutRow.findMany({
      where: { collectionLayoutId: copy.id },
      select: { line: true, _count: { select: { quotations: true } } },
      orderBy: { line: 'asc' },
    });
    expect(rows).toEqual([
      { line: 'Tote', _count: { quotations: 0 } },
      { line: 'Zaino', _count: { quotations: 1 } },
    ]);
  });

  it('refuses a row that is not in the source, and creates nothing', async () => {
    const target = await newSeason();

    await expect(
      copyTo(target, [
        { id: rowIds[0], copyQuotations: true },
        { id: randomUUID(), copyQuotations: true },
      ])
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await targetLayout(target)).toBeNull();
  });

  it('refuses an empty selection, and creates nothing', async () => {
    const target = await newSeason();

    await expect(copyTo(target, [])).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await targetLayout(target)).toBeNull();
  });
});
