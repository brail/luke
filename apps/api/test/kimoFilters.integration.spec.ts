/**
 * KIMO statistics: the salesperson filter offers exactly the salespersons the report can return
 * (#233). The report reads sales orders and baskets by brand and season with conditions on their
 * lines too; a salesperson offered outside them would give an empty report.
 */

import { randomInt, randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';
import { queryKimoFromPg } from '@luke/nav';

import { createCallerAs, setupTestDb } from './helpers';

let prisma: PrismaClient;

const uid = randomUUID().substring(0, 5).toUpperCase();
const BRAND = `KB${uid}`;
const SEASON_1 = `K1${uid}`;
const SEASON_2 = `K2${uid}`;

/** Salespersons the report returns for season 1. */
const SP_BASKET = `SA${uid}`;
const SP_ORDER = `SD${uid}`;
/** Salespersons the report leaves out of season 1. */
const SP_BASKET_SEASON_2 = `SB${uid}`;
const SP_BASKET_NO_REPORTED_LINE = `SC${uid}`;
const SP_BASKET_ASSIGNED = `SF${uid}`;
const SP_ORDER_LINE_DELETED = `SE${uid}`;
const SP_ORDER_OTHER_LINE_TYPE = `SG${uid}`;
const SP_ORDER_NO_LINE = `SH${uid}`;

let brandId: string;
let season1Id: string;
let season2Id: string;

beforeAll(async () => {
  prisma = await setupTestDb();

  const [brand, season1, season2] = await Promise.all([
    prisma.brand.create({ data: { code: BRAND, name: `Kimo brand ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: SEASON_1, name: `Kimo S1 ${uid}`, year: 2032, isActive: true } }),
    prisma.season.create({ data: { code: SEASON_2, name: `Kimo S2 ${uid}`, year: 2033, isActive: true } }),
  ]);
  brandId = brand.id;
  season1Id = season1.id;
  season2Id = season2.id;

  // Entry numbers are primary keys shared by every spec in the worker's database.
  const base = BigInt(randomInt(1, 2 ** 40)) * 10n;
  const baskets = [
    { sp: SP_BASKET, season: SEASON_1, lineType: 2, assigned: '' },
    { sp: SP_BASKET_SEASON_2, season: SEASON_2, lineType: 20, assigned: '' },
    { sp: SP_BASKET_NO_REPORTED_LINE, season: SEASON_1, lineType: 1, assigned: '' },
    { sp: SP_BASKET_ASSIGNED, season: SEASON_1, lineType: 2, assigned: `SO${uid}` },
  ];
  const orders = [
    { sp: SP_ORDER, line: { type: 19, deleteReason: null } },
    { sp: SP_ORDER_LINE_DELETED, line: { type: 19, deleteReason: 'CANC' } },
    { sp: SP_ORDER_OTHER_LINE_TYPE, line: { type: 1, deleteReason: null } },
    { sp: SP_ORDER_NO_LINE, line: null },
    // NAV stores a missing salesperson as '': the report reads '' as no filter, so it is not offered.
    { sp: '', line: { type: 19, deleteReason: null } },
  ];

  await prisma.navKimoSalesHeader.createMany({
    data: baskets.map((b, i) => ({
      entryNo: base + BigInt(i),
      trademarkCode: BRAND,
      sellingSeasonCode: b.season,
      salespersonCodeNav: b.sp,
      assignedSalesDocumentNo: b.assigned,
    })),
  });
  await prisma.navKimoSalesLine.createMany({
    data: baskets.map((b, i) => ({ entryNo: base + BigInt(i), headerEntryNo: base + BigInt(i), type: b.lineType })),
  });
  await prisma.navPfSalesHeader.createMany({
    data: orders.map((o, i) => ({
      no_: `OR${uid}${i}`,
      documentType: 1,
      sellingSeasonCode: SEASON_1,
      shortcutDimension2Code: BRAND,
      salespersonCode: o.sp,
    })),
  });
  await prisma.navPfSalesLine.createMany({
    data: orders.flatMap((o, i) =>
      o.line ? [{ documentType: 1, documentNo: `OR${uid}${i}`, lineNo: 10000, ...o.line }] : []
    ),
  });
  await prisma.navPfSalesperson.createMany({
    data: [...baskets, ...orders].filter(r => r.sp).map(r => ({ code: r.sp, name: `Agent ${r.sp}` })),
  });
});

const filterCodes = async (seasonId: string) =>
  (await (await createCallerAs('admin')).sales.statistics.kimo.getFilters({ brandId, seasonId }))
    .salespersons.map(s => s.code).sort();

describe('kimo.getFilters — salespersons', () => {
  it('lists the salespersons with a reported order or basket in the season, no one else', async () => {
    expect(await filterCodes(season1Id)).toEqual([SP_BASKET, SP_ORDER].sort());
    expect(await filterCodes(season2Id)).toEqual([SP_BASKET_SEASON_2]);
  });

  it('lists the same salespersons the report returns', async () => {
    const report = await queryKimoFromPg(prisma, { seasonCode: SEASON_1, trademarkCode: BRAND });
    // Rows with no salesperson are in the report too, but there is nobody to offer for them.
    const reported = [...new Set(report.map(r => r.salespersonCodeNav).filter(code => !!code))].sort();

    expect(await filterCodes(season1Id)).toEqual(reported);
  });
});
