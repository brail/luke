/**
 * Kimo + Bidone — query PostgreSQL UNION di:
 *  - Step 0 (SO): ordini di vendita da nav_pf_sales_header / sales_line
 *  - Step 1 (BASKET): ordini KIMO-FASHION non ancora assegnati a un SO
 *
 * Replica fedelmente la logica Access (query #13/#14/#15 in kimo-test.txt):
 *  - SO filtrati per stagione + marchio (shortcutDimension2Code)
 *  - BASKET filtrati per marchio (kh.trademarkCode) + stagione (item.seasonCode)
 *    dove assignedSalesDocumentNo = '' e type IN (2, 20)
 */

import type { PrismaClient } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KimoParams {
  seasonCode: string;
  trademarkCode: string;
  salespersonCode?: string;
  customerCode?: string;
}

export interface KimoRow {
  docType: string;
  trademarkCode: string | null;
  salespersonCodeNav: string | null;
  salespersonName: string | null;
  entryNo: string;              // BigInt serializzato come string
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

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Esegue la UNION SO + BASKET su PostgreSQL (tabelle nav_pf_* e nav_kimo_*).
 * Restituisce le righe ordinate per trademarkCode, salespersonCodeNav.
 */
export async function queryKimoFromPg(
  prisma: PrismaClient,
  params: KimoParams,
): Promise<KimoRow[]> {
  const { seasonCode, trademarkCode, salespersonCode, customerCode } = params;

  // Parametri base: $1 = seasonCode, $2 = trademarkCode
  const sqlParams: unknown[] = [seasonCode, trademarkCode];
  let pi = 3;

  // Filtri opzionali identici per entrambi i rami della UNION
  const spFilterSo = salespersonCode ? `AND sh."salespersonCode" = $${pi}` : '';
  const spFilterBa = salespersonCode ? `AND kh."salespersonCodeNav" = $${pi}` : '';
  if (salespersonCode) { sqlParams.push(salespersonCode); pi++; }

  const custFilterSo = customerCode ? `AND sh."sellToCustomerNo" = $${pi}` : '';
  const custFilterBa = customerCode ? `AND c."no_" = $${pi}` : '';
  if (customerCode) { sqlParams.push(customerCode); pi++; }

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
  ON sl."documentNo" = sh."no_"
 AND sl."documentType" = sh."documentType"
LEFT JOIN nav_pf_salesperson sp
  ON sh."salespersonCode" = sp."code"
LEFT JOIN nav_pf_item i
  ON sl."no_" = i."no_"
LEFT JOIN nav_pf_vendor v
  ON i."vendorNo" = v."no_"
LEFT JOIN nav_pf_customer c
  ON sh."sellToCustomerNo" = c."no_"
WHERE sh."sellingSeasonCode" = $1
  AND sh."shortcutDimension2Code" = $2
  AND sl."type" IN (19, 20)
  AND (sl."deleteReason" IS NULL OR sl."deleteReason" = '')
  ${spFilterSo}
  ${custFilterSo}

UNION ALL

-- ── Step 1: KIMO-FASHION Basket (ordini non ancora assegnati) ─────────────────
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
  kh."releaseSoDateTime"                               AS "releaseSoDateTime",
  kl."kimoFashionSoReference"                          AS "kimoFashionSoReference",
  kh."kimoDocumentType"                                AS "kimoDocumentType"
FROM nav_kimo_sales_line kl
JOIN nav_kimo_sales_header kh
  ON kl."headerEntryNo" = kh."entryNo"
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
WHERE (kh."assignedSalesDocumentNo" IS NULL OR kh."assignedSalesDocumentNo" = '')
  AND kl."type" IN (2, 20)
  AND kh."trademarkCode" = $2
  AND kh."sellingSeasonCode" = $1
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

  const rows = await prisma.$queryRawUnsafe<KimoRow[]>(sql, ...sqlParams);
  return rows;
}
