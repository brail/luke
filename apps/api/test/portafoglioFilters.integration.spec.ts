/**
 * Order-portfolio statistics: the salesperson filter offers exactly the salespersons the report can
 * return (#240). The report reads order headers by brand and season, and only their sales or return
 * lines of an item type; a salesperson offered outside them would give an empty report.
 */

import { randomUUID } from 'crypto';

import { beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';
import { queryPortafoglioFromPg } from '@luke/nav';

import { createCallerAs, setupTestDb } from './helpers';

let prisma: PrismaClient;

const uid = randomUUID().substring(0, 5).toUpperCase();
const BRAND = `PB${uid}`;
const SEASON_1 = `P1${uid}`;
const SEASON_2 = `P2${uid}`;
/** A season the replica holds only an order with no reported line for. */
const SEASON_3 = `P3${uid}`;

/** Salespersons the report returns for season 1. */
const SP_ORDER = `SA${uid}`;
const SP_RETURN = `SR${uid}`;
/** Salespersons the report leaves out of season 1. */
const SP_SEASON_2 = `SS${uid}`;
const SP_OTHER_DOCUMENT_TYPE = `SD${uid}`;
const SP_OTHER_LINE_TYPE = `SL${uid}`;
const SP_NO_LINE = `SN${uid}`;

let brandId: string;
let season1Id: string;
let season2Id: string;
let season3Id: string;

beforeAll(async () => {
  prisma = await setupTestDb();

  const [brand, season1, season2, season3] = await Promise.all([
    prisma.brand.create({ data: { code: BRAND, name: `Portfolio brand ${uid}`, isActive: true } }),
    prisma.season.create({ data: { code: SEASON_1, name: `Portfolio S1 ${uid}`, year: 2032, isActive: true } }),
    prisma.season.create({ data: { code: SEASON_2, name: `Portfolio S2 ${uid}`, year: 2033, isActive: true } }),
    prisma.season.create({ data: { code: SEASON_3, name: `Portfolio S3 ${uid}`, year: 2034, isActive: true } }),
  ]);
  brandId = brand.id;
  season1Id = season1.id;
  season2Id = season2.id;
  season3Id = season3.id;

  // Document type 1 is a sales order, 5 a return; 0 (a quote) is outside the report.
  const orders = [
    { sp: SP_ORDER, season: SEASON_1, documentType: 1, lineType: 19 },
    { sp: SP_RETURN, season: SEASON_1, documentType: 5, lineType: 20 },
    { sp: SP_SEASON_2, season: SEASON_2, documentType: 1, lineType: 19 },
    { sp: SP_OTHER_DOCUMENT_TYPE, season: SEASON_1, documentType: 0, lineType: 19 },
    { sp: SP_OTHER_LINE_TYPE, season: SEASON_1, documentType: 1, lineType: 1 },
    { sp: SP_NO_LINE, season: SEASON_1, documentType: 1, lineType: null },
    { sp: SP_NO_LINE, season: SEASON_3, documentType: 1, lineType: null },
    // NAV stores a missing salesperson as '': the report reads '' as no filter, so it is not offered.
    { sp: '', season: SEASON_1, documentType: 1, lineType: 19 },
  ];

  await prisma.navPfSalesHeader.createMany({
    data: orders.map((o, i) => ({
      no_: `PO${uid}${i}`,
      documentType: o.documentType,
      sellingSeasonCode: o.season,
      shortcutDimension2Code: BRAND,
      salespersonCode: o.sp,
    })),
  });
  await prisma.navPfSalesLine.createMany({
    data: orders.flatMap((o, i) =>
      o.lineType === null ? [] : [{ documentType: o.documentType, documentNo: `PO${uid}${i}`, lineNo: 10000, type: o.lineType }]
    ),
  });
  await prisma.navPfSalesperson.createMany({
    data: [...new Set(orders.map(o => o.sp).filter(Boolean))].map(code => ({ code, name: `Agent ${code}` })),
  });
});

const filterCodes = async (seasonId: string) =>
  (await (await createCallerAs('admin')).sales.statistics.portafoglio.getFilters({ brandId, seasonId }))
    .salespersons.map(s => s.code).sort();

describe('portafoglio.getFilters — salespersons', () => {
  it('lists the salespersons with a reported sales or return line in the season, no one else', async () => {
    expect(await filterCodes(season1Id)).toEqual([SP_ORDER, SP_RETURN].sort());
    expect(await filterCodes(season2Id)).toEqual([SP_SEASON_2]);
  });

  it('lists the same salespersons the report returns', async () => {
    const report = await queryPortafoglioFromPg(prisma, { seasonCode: SEASON_1, trademarkCode: BRAND });
    // Rows with no salesperson are in the report too, but there is nobody to offer for them.
    const reported = [...new Set(report.map(r => r['Salesperson Code']).filter(code => !!code))].sort();

    expect(await filterCodes(season1Id)).toEqual(reported);
  });

  it('answers from the replica when it holds the season, even with nobody to offer', async () => {
    // The replica holds an order for season 3, so the report reads it, not NAV: an empty list, not
    // the NAV headers (with no NAV configured, the NAV path would refuse instead).
    expect(await filterCodes(season3Id)).toEqual([]);
  });
});
