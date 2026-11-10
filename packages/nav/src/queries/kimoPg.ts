/**
 * Kimo + Bidone — PostgreSQL UNION query of:
 *  - Step 0 (SO): sales orders from nav_pf_sales_header / sales_line
 *  - Step 1 (BASKET): KIMO-FASHION orders not yet assigned to an SO
 *
 * Faithfully replicates the Access logic (queries #13/#14/#15 in kimo-test.txt):
 *  - SO filtered by season + brand (shortcutDimension2Code), lines of type IN (19, 20) with no
 *    deleteReason
 *  - BASKET filtered by brand (kh.trademarkCode) + the header's season (kh.sellingSeasonCode)
 *    where assignedSalesDocumentNo is empty and the line type is IN (2, 20)
 */

import type { PrismaClient } from '@luke/db';

import { PgParams } from './pgParams.js';

import type { PortafoglioParams } from '../statistics/portafoglio.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Same filters as the portfolio: season+brand mandatory, agent/customer optional. */
export type KimoParams = PortafoglioParams;

export interface KimoRow {
  docType: string;
  trademarkCode: string | null;
  salespersonCodeNav: string | null;
  salespersonName: string | null;
  entryNo: string;              // BigInt serialized as a string
  no_: string | null;
  modelItemNo: string | null;
  colorCode: string | null;
  sizeCode: string | null;
  description: string | null;
  description2: string | null;
  lineCode: string | null;
  pairs: number | null;
  valueSold: number | null;
  vendorNo: string | null;
  vendorName: string | null;
  manufacturerCode: string | null;
  manufacturerName: string | null;
  collectionCode: string | null;
  seasonCode: string | null;
  assignedSalesDocumentNo: string | null;
  customerNo: string | null;
  customerName: string | null;
  type: number | null;
  createSoDateTime: Date | null;
  releaseSoDateTime: Date | null;
  kimoFashionSoReference: string | null;
  kimoDocumentType: string | null;
}

// ─── What the report reads ────────────────────────────────────────────────────
//
// One definition of the rows the report selects, shared by the report and by the salesperson
// filter (`queryKimoSalespersonCodes`), so the filter offers exactly who the report can return
// (#233). Every fragment reads `$1` = season and `$2` = brand: build the parameters with
// `kimoBaseParams`.

/** Sales orders (`sh` headers, `sl` lines): brand and season on the header. */
const SO_HEADER = `sh."sellingSeasonCode" = $1 AND sh."shortcutDimension2Code" = $2`;
const SO_LINE_OF_HEADER = `sl."documentNo" = sh."no_" AND sl."documentType" = sh."documentType"`;
const SO_LINE = `sl."type" IN (19, 20) AND (sl."deleteReason" IS NULL OR sl."deleteReason" = '')`;

/** Baskets (`kh` headers, `kl` lines) not yet assigned to a sales order: brand and the header's season. */
const BASKET_HEADER = `(kh."assignedSalesDocumentNo" IS NULL OR kh."assignedSalesDocumentNo" = '')
  AND kh."trademarkCode" = $2 AND kh."sellingSeasonCode" = $1`;
const BASKET_LINE_OF_HEADER = `kl."headerEntryNo" = kh."entryNo"`;
const BASKET_LINE = `kl."type" IN (2, 20)`;

/** `$1` = season, `$2` = brand: the order every fragment above reads. */
const kimoBaseParams = (params: Pick<KimoParams, 'seasonCode' | 'trademarkCode'>) =>
  new PgParams([params.seasonCode, params.trademarkCode]);

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Runs the SO + BASKET UNION query on PostgreSQL against the nav_pf_* and nav_kimo_* replica tables.
 * Mirrors the Access query logic (queries #13/#14/#15 from kimo-test.txt).
 *
 * @returns Rows ordered by trademarkCode, salespersonCodeNav.
 */
export async function queryKimoFromPg(
  prisma: PrismaClient,
  params: KimoParams,
): Promise<KimoRow[]> {
  const { seasonCode, trademarkCode, salespersonCode, customerCode } = params;

  const p = kimoBaseParams({ seasonCode, trademarkCode });

  // Optional filters, identical for both branches of the UNION
  let spFilterSo = '', spFilterBa = '';
  if (salespersonCode) {
    const ph = p.add(salespersonCode);
    spFilterSo = `AND sh."salespersonCode" = ${ph}`;
    spFilterBa = `AND kh."salespersonCodeNav" = ${ph}`;
  }

  let custFilterSo = '', custFilterBa = '';
  if (customerCode) {
    const ph = p.add(customerCode);
    custFilterSo = `AND sh."sellToCustomerNo" = ${ph}`;
    custFilterBa = `AND c."no_" = ${ph}`;
  }

  const sql = `
-- ── Step 0: Sales Orders (SO) ────────────────────────────────────────────────
SELECT
  'SO'                                                 AS "docType",
  sh."shortcutDimension2Code"                          AS "trademarkCode",
  sh."salespersonCode"                                 AS "salespersonCodeNav",
  sp."name"                                            AS "salespersonName",
  '0'                                                  AS "entryNo",
  ''                                                   AS "no_",
  sl."no_"                                             AS "modelItemNo",
  sl."constantVariableCode"                            AS "colorCode",
  sl."assortmentCode"                                  AS "sizeCode",
  i."description"                                      AS "description",
  i."description2"                                     AS "description2",
  i."lineCode"                                         AS "lineCode",
  sl."noOfPairs"                                       AS "pairs",
  (COALESCE(sl."lineAmount", 0) - COALESCE(sl."invDiscountAmount", 0))
                                                       AS "valueSold",
  i."vendorNo"                                         AS "vendorNo",
  v."name"                                             AS "vendorName",
  ''                                                   AS "manufacturerCode",
  ''                                                   AS "manufacturerName",
  i."collectionCode"                                   AS "collectionCode",
  sh."sellingSeasonCode"                               AS "seasonCode",
  ''                                                   AS "assignedSalesDocumentNo",
  sh."sellToCustomerNo"                                AS "customerNo",
  c."name"                                             AS "customerName",
  sl."type"                                            AS "type",
  NULL::TIMESTAMP                                    AS "createSoDateTime",
  NULL::TIMESTAMP                                    AS "releaseSoDateTime",
  ''                                                   AS "kimoFashionSoReference",
  ''                                                   AS "kimoDocumentType"
FROM nav_pf_sales_line sl
JOIN nav_pf_sales_header sh
  ON ${SO_LINE_OF_HEADER}
LEFT JOIN nav_pf_salesperson sp
  ON sh."salespersonCode" = sp."code"
LEFT JOIN nav_pf_item i
  ON sl."no_" = i."no_"
LEFT JOIN nav_pf_vendor v
  ON i."vendorNo" = v."no_"
LEFT JOIN nav_pf_customer c
  ON sh."sellToCustomerNo" = c."no_"
WHERE ${SO_HEADER}
  AND ${SO_LINE}
  ${spFilterSo}
  ${custFilterSo}

UNION ALL

-- ── Step 1: KIMO-FASHION Basket (orders not yet assigned) ─────────────────
SELECT
  'BASKET'                                             AS "docType",
  kh."trademarkCode"                                   AS "trademarkCode",
  kh."salespersonCodeNav"                              AS "salespersonCodeNav",
  sp."name"                                            AS "salespersonName",
  kh."entryNo"::TEXT                                   AS "entryNo",
  kl."no_"                                             AS "no_",
  kl."modelItemNo"                                     AS "modelItemNo",
  kl."colorCode"                                       AS "colorCode",
  kl."sizeCode"                                        AS "sizeCode",
  i."description"                                      AS "description",
  i."description2"                                     AS "description2",
  i."lineCode"                                         AS "lineCode",
  SUM(COALESCE(kl."quantity", 0))                      AS "pairs",
  SUM(COALESCE(kl."lineAmount", 0))                    AS "valueSold",
  i."vendorNo"                                         AS "vendorNo",
  v."name"                                             AS "vendorName",
  i."manufacturer"                                     AS "manufacturerCode",
  vm."name"                                            AS "manufacturerName",
  i."collectionCode"                                   AS "collectionCode",
  i."seasonCode"                                       AS "seasonCode",
  COALESCE(kh."assignedSalesDocumentNo", '')           AS "assignedSalesDocumentNo",
  c."no_"                                              AS "customerNo",
  c."name"                                             AS "customerName",
  kl."type"                                            AS "type",
  kh."createSoDateTime"                                AS "createSoDateTime",
  kh."releaseSoDateTime"                                AS "releaseSoDateTime",
  kl."kimoFashionSoReference"                          AS "kimoFashionSoReference",
  kh."kimoDocumentType"                                AS "kimoDocumentType"
FROM nav_kimo_sales_line kl
JOIN nav_kimo_sales_header kh
  ON ${BASKET_LINE_OF_HEADER}
LEFT JOIN nav_pf_customer c
  ON kh."sellToCustomerNo" = c."no_"
LEFT JOIN nav_pf_item i
  ON kl."modelItemNo" = i."no_"
LEFT JOIN nav_pf_vendor v
  ON i."vendorNo" = v."no_"
LEFT JOIN nav_pf_vendor vm
  ON i."manufacturer" = vm."no_"
LEFT JOIN nav_pf_salesperson sp
  ON kh."salespersonCodeNav" = sp."code"
WHERE ${BASKET_HEADER}
  AND ${BASKET_LINE}
  ${spFilterBa}
  ${custFilterBa}
GROUP BY
  kh."trademarkCode",
  kh."salespersonCodeNav",
  sp."name",
  kh."entryNo",
  kl."no_",
  kl."modelItemNo",
  kl."colorCode",
  kl."sizeCode",
  i."description",
  i."description2",
  i."lineCode",
  i."vendorNo",
  v."name",
  i."manufacturer",
  vm."name",
  i."collectionCode",
  i."seasonCode",
  kh."assignedSalesDocumentNo",
  c."no_",
  c."name",
  kl."type",
  kh."createSoDateTime",
  kh."releaseSoDateTime",
  kl."kimoFashionSoReference",
  kh."kimoDocumentType"

ORDER BY "trademarkCode", "salespersonCodeNav"
  `;

  // nosemgrep: luke-prisma-raw-unsafe -- `sql` is built only from constant fragments and PgParams placeholders ($1, $2...); every value is bound as a parameter, never interpolated
  const rows = await prisma.$queryRawUnsafe<KimoRow[]>(sql, ...p.values);
  return rows;
}

/**
 * The salespersons the KIMO report can return for a brand and season — those with a sales order or
 * a basket among the rows `queryKimoFromPg` reads — so the filter offers no one the report would
 * leave out (#233). A header counts once one of its lines qualifies (`EXISTS`, no line scan). A
 * missing or blank code (NAV stores blanks as '') is not offered: the report reads '' as no filter.
 */
export async function queryKimoSalespersonCodes(
  prisma: PrismaClient,
  params: Pick<KimoParams, 'seasonCode' | 'trademarkCode'>,
): Promise<string[]> {
  const p = kimoBaseParams(params);
  const sql = `
SELECT sh."salespersonCode" AS "code"
FROM nav_pf_sales_header sh
WHERE ${SO_HEADER}
  AND sh."salespersonCode" <> ''
  AND EXISTS (SELECT 1 FROM nav_pf_sales_line sl WHERE ${SO_LINE_OF_HEADER} AND ${SO_LINE})
UNION
SELECT kh."salespersonCodeNav"
FROM nav_kimo_sales_header kh
WHERE ${BASKET_HEADER}
  AND kh."salespersonCodeNav" <> ''
  AND EXISTS (SELECT 1 FROM nav_kimo_sales_line kl WHERE ${BASKET_LINE_OF_HEADER} AND ${BASKET_LINE})`;

  // nosemgrep: luke-prisma-raw-unsafe -- `sql` is built only from constant fragments and PgParams placeholders ($1, $2); every value is bound as a parameter, never interpolated
  const rows = await prisma.$queryRawUnsafe<{ code: string }[]>(sql, ...p.values);
  return rows.map(r => r.code);
}
