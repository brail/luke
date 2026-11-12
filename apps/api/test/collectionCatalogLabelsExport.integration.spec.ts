/**
 * Exports print a catalog value as its item's label (#245), read live from the catalog: a label
 * renamed after the data was written prints renamed, a deactivated item still prints its label, and
 * nothing in the rows changes. A revision prints today's labels for the values it captured (D3); a
 * value no item has, such as an automatic revision type, prints as itself.
 *
 * Integration tier: the labels come from `collection_catalog_items`, the values from a revision
 * snapshot, both in the database.
 */

import { randomUUID } from 'crypto';

import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { buildRevisionXlsx } from '../src/services/collectionLayout.export.revision.service';
import { AUTO_REVISION_TYPE_DATE } from '../src/services/collectionLayoutAutoRevision.service';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;
const uid = randomUUID().substring(0, 6).toUpperCase();
const values = { lineStatus: `LS${uid}`, productCategory: `PC${uid}`, revisionType: `RT${uid}` };
let layoutId: string;
let revision: { id: string; revisionNumber: number };

async function sheetValues(buffer: Buffer): Promise<unknown[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer); // exceljs types `load` with ArrayBuffer; it reads a Buffer
  return workbook.worksheets.flatMap(sheet => sheet.getSheetValues().flat());
}

beforeAll(async () => {
  prisma = await setupTestDb();
  const asAdmin = createCallerWithSession((await createTestUser('admin')).session);

  await prisma.collectionCatalogItem.createMany({
    data: [
      { type: 'lineStatus', value: values.lineStatus, label: 'Nuovo' },
      { type: 'productCategory', value: values.productCategory, label: 'Stivale' },
      { type: 'revisionType', value: values.revisionType, label: 'Revisione di prova' },
    ],
  });
  const [brand, season] = await Promise.all([
    prisma.brand.create({ data: { code: `CL${uid}`, name: `Catalog Labels ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: `CL${uid}`, name: `Catalog Labels ${uid}`, year: 2035, isActive: true } }),
  ]);
  const layout = await asAdmin.collectionLayout.getOrCreate({ brandId: brand.id, seasonId: season.id, availableGenders: ['MAN'] });
  const group = await asAdmin.collectionLayout.groups.create({ collectionLayoutId: layout.id, data: { name: 'Gruppo', order: 0 } });
  await asAdmin.collectionLayout.rows.create({
    groupId: group.id,
    gender: 'MAN',
    line: 'Linea',
    status: values.lineStatus,
    productCategory: values.productCategory,
    skuForecast: null,
    qtyForecast: null,
  });
  layoutId = layout.id;
  revision = await asAdmin.collectionLayoutRevision.create({ collectionLayoutId: layout.id, revisionTypeValue: values.revisionType });

  // After the revision: rename one label, deactivate another item.
  await prisma.collectionCatalogItem.update({
    where: { type_value: { type: 'lineStatus', value: values.lineStatus } },
    data: { label: 'Nuovo rinominato' },
  });
  await prisma.collectionCatalogItem.update({
    where: { type_value: { type: 'productCategory', value: values.productCategory } },
    data: { isActive: false },
  });
});

afterAll(async () => {
  // Shared database: leave no catalog item behind for the specs that list a type.
  await prisma.collectionCatalogItem.deleteMany({ where: { value: { in: Object.values(values) } } });
});

describe('catalog labels in a revision export', () => {
  it("prints today's labels, a deactivated item's included, for the values the revision captured", async () => {
    const meta = { revisionNumber: revision.revisionNumber, revisionTypeValue: values.revisionType, notes: null };

    const printed = await sheetValues(await buildRevisionXlsx(revision.id, layoutId, meta, prisma));

    expect(printed).toEqual(expect.arrayContaining(['Nuovo rinominato', 'Stivale', 'Revisione di prova']));
    for (const value of Object.values(values)) expect(printed).not.toContain(value);
  });

  it('prints a revision type no item has as itself', async () => {
    const meta = { revisionNumber: revision.revisionNumber, revisionTypeValue: AUTO_REVISION_TYPE_DATE, notes: null };

    const printed = await sheetValues(await buildRevisionXlsx(revision.id, layoutId, meta, prisma));

    expect(printed).toContain(AUTO_REVISION_TYPE_DATE);
  });
});
