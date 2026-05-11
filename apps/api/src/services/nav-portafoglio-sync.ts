/**
 * NAV → PostgreSQL sync per le tabelle analytics del portafoglio ordini.
 *
 * Strategia per tabella:
 *  - Sales Header / Line / Header Ext: incrementale via rowversion SQL Server,
 *    filtrato alle stagioni attive (Season.isActive = true).
 *  - Item / Customer / ShipToAddress: incrementale via rowversion, NO season filter.
 *  - Lookup (Salesperson, GeoZone, ecc.): full sync ad ogni ciclo (tabelle piccole).
 *  - DatePrenotazione / DdtPicking: full-refresh (query aggregata), scoped ai
 *    document-nos già presenti in nav_pf_sales_header.
 *
 * Il ciclo è progettato per girare ogni 5 min in background.
 * Al di là del primo sync (full), le successive passate sono tipicamente <10 s.
 */

import type { PrismaClient } from '@prisma/client';
import mssql from 'mssql';
import type { Logger } from 'pino';

import { sanitizeCompany } from '@luke/nav';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TableSyncStats {
  table: string;
  rowsUpserted: number;
  durationMs: number;
}

export interface PortafoglioSyncResult {
  stats: TableSyncStats[];
  totalDurationMs: number;
  seasonCodes: string[];
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Righe per SELECT su SQL Server per ciclo (chunking). */
const SS_CHUNK = 3_000;

/** Righe per INSERT batch su PG. */
const PG_BATCH = 500;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Bulk upsert generico via raw SQL.
 * I column names sono controllati internamente (non input utente): $executeRawUnsafe è sicuro.
 * Le colonne PK non vengono incluse nel DO UPDATE SET.
 */
async function bulkUpsert(
  prisma: PrismaClient,
  table: string,
  pk: readonly string[],
  rows: Record<string, unknown>[],
): Promise<void> {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]!);
  const nonPk = cols.filter(c => !pk.includes(c));
  if (nonPk.length === 0) return; // no non-pk columns to update

  const colList = cols.map(c => `"${c}"`).join(', ');
  const pkList  = pk.map(c => `"${c}"`).join(', ');
  const setList = nonPk.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');

  for (let i = 0; i < rows.length; i += PG_BATCH) {
    const chunk = rows.slice(i, i + PG_BATCH);
    const params: unknown[] = [];
    const vals = chunk.map(row => {
      const placeholders = cols.map(c => {
        let val = row[c] ?? null;
        // mssql restituisce BIGINT come stringa JS; convertiamo a BigInt per PG
        if (c === 'navRowversion' && typeof val === 'string') val = BigInt(val);
        params.push(val);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${table}" (${colList}) VALUES ${vals.join(', ')} ON CONFLICT (${pkList}) DO UPDATE SET ${setList}`,
      ...params,
    );
  }
}

async function getLastRowversion(prisma: PrismaClient, tableName: string): Promise<bigint> {
  const s = await prisma.navPfSyncState.findUnique({ where: { tableName } });
  return s?.lastRowversion ?? BigInt(0);
}

async function updateSyncState(
  prisma: PrismaClient,
  tableName: string,
  lastRowversion: bigint,
  rowCount: number,
  durationMs: number,
): Promise<void> {
  await prisma.navPfSyncState.upsert({
    where:  { tableName },
    create: { tableName, lastRowversion, rowCount, lastDurationMs: durationMs, lastSyncedAt: new Date() },
    update: { lastRowversion, rowCount, lastDurationMs: durationMs, lastSyncedAt: new Date() },
  });
}

/**
 * Aggiunge i parametri stagione a un request mssql e ritorna la IN clause.
 * Es: ["E26", "I26"] → "@s0, @s1"
 */
function bindSeasons(req: mssql.Request, seasons: string[]): string {
  seasons.forEach((code, i) => req.input(`s${i}`, mssql.NVarChar(10), code));
  return seasons.map((_, i) => `@s${i}`).join(', ');
}

// ─── Per-table sync functions ─────────────────────────────────────────────────

async function syncSalesHeader(
  pool: mssql.ConnectionPool,
  co: string,
  prisma: PrismaClient,
  seasons: string[],
  logger: Logger,
): Promise<TableSyncStats> {
  const TABLE = 'nav_pf_sales_header';
  const t0 = Date.now();
  let totalRows = 0;

  let lastRv = await getLastRowversion(prisma, TABLE);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const req = pool.request();
    const inClause = bindSeasons(req, seasons);
    req.input('rv', mssql.BigInt, lastRv);

    const result = await req.query<Record<string, unknown>>(`
      SELECT TOP (${SS_CHUNK})
        sh.[No_]                              AS "no_",
        sh.[Document Type]                    AS "documentType",
        sh.[Order Date]                       AS "orderDate",
        sh.[Sell-to Customer No_]             AS "sellToCustomerNo",
        sh.[Bill-to Customer No_]             AS "billToCustomerNo",
        sh.[Bill-to Name]                     AS "billToName",
        sh.[Salesperson Code]                 AS "salespersonCode",
        sh.[Area Manager Code]                AS "areaManagerCode",
        sh.[Subject 1]                        AS "subject1",
        sh.[Subject 2]                        AS "subject2",
        sh.[Currency Code]                    AS "currencyCode",
        sh.[Ship-to Code]                     AS "shipToCode",
        sh.[Ship-to Name]                     AS "shipToName",
        sh.[Ship-to Name 2]                   AS "shipToName2",
        sh.[Ship-to Address]                  AS "shipToAddress",
        sh.[Ship-to Address 2]                AS "shipToAddress2",
        sh.[Ship-to City]                     AS "shipToCity",
        sh.[Ship-to Post Code]                AS "shipToPostCode",
        sh.[Ship-to County]                   AS "shipToCounty",
        sh.[Shipment Method Code]             AS "shipmentMethodCode",
        sh.[Transport Reason Code]            AS "transportReasonCode",
        sh.[Shipping Agent Code]              AS "shippingAgentCode",
        sh.[Shipping Agent Service Code]      AS "shippingAgentServiceCode",
        sh.[Payment Terms Code]               AS "paymentTermsCode",
        sh.[Payment Method Code]              AS "paymentMethodCode",
        sh.[Invoice Discount Calculation]     AS "invoiceDiscountCalculation",
        ISNULL(TRY_CAST(sh.[Invoice Discount Value] AS FLOAT), 0) AS "invoiceDiscountValue",
        sh.[Consignment]                      AS "consignment",
        ISNULL(TRY_CAST(sh.[Right on Return _] AS FLOAT), 0)      AS "rightOnReturnPct",
        sh.[Note]                             AS "note",
        sh.[Campaign No_]                     AS "campaignNo",
        sh.[Securities Received]              AS "securitiesReceived",
        sh.[Anomalous]                        AS "anomalous",
        sh.[Not Anomalous]                    AS "notAnomalous",
        sh.[Anomalous Date]                   AS "anomalousDate",
        sh.[Checked]                          AS "checked",
        sh.[Checked Date]                     AS "checkedDate",
        sh.[Budget No_]                       AS "budgetNo",
        sh.[Course Date]                      AS "courseDate",
        sh.[KIMO_FASHION SO No_]              AS "kimoFashionSoNo",
        sh.[Order Type]                       AS "orderType",
        sh.[Fast Shipping]                    AS "fastShipping",
        sh.[Commission Group Code]            AS "commissionGroupCode",
        sh.[Geographical Zone]                AS "geographicalZone",
        sh.[Selling Season Code]              AS "sellingSeasonCode",
        sh.[Shortcut Dimension 2 Code]        AS "shortcutDimension2Code",
        sh.[Customer Posting Group]           AS "customerPostingGroup",
        CONVERT(BIGINT, sh.[timestamp])       AS "navRowversion"
      FROM [${co}$Sales Header] sh
      WHERE sh.[Document Type] IN (1, 5)
        AND sh.[Selling Season Code] IN (${inClause})
        AND CONVERT(BIGINT, sh.[timestamp]) > @rv
      ORDER BY sh.[timestamp]
    `);

    const rows = result.recordset;
    if (!rows.length) break;

    await bulkUpsert(prisma, TABLE, ['no_'], rows);
    totalRows += rows.length;

    const maxRv = rows.reduce((m: bigint, r: Record<string, unknown>) => {
      const v = BigInt(r['navRowversion'] as number);
      return v > m ? v : m;
    }, lastRv);
    lastRv = maxRv;

    if (rows.length < SS_CHUNK) break;
  }

  const dur = Date.now() - t0;
  await updateSyncState(prisma, TABLE, lastRv, totalRows, dur);
  logger.debug({ table: TABLE, rows: totalRows, ms: dur }, 'nav-pf sync done');
  return { table: TABLE, rowsUpserted: totalRows, durationMs: dur };
}

async function syncSalesLines(
  pool: mssql.ConnectionPool,
  co: string,
  prisma: PrismaClient,
  seasons: string[],
  logger: Logger,
): Promise<TableSyncStats> {
  const TABLE = 'nav_pf_sales_line';
  const t0 = Date.now();
  let totalRows = 0;
  let lastRv = await getLastRowversion(prisma, TABLE);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const req = pool.request();
    const inClause = bindSeasons(req, seasons);
    req.input('rv', mssql.BigInt, lastRv);

    const result = await req.query<Record<string, unknown>>(`
      SELECT TOP (${SS_CHUNK})
        sl.[Document Type]                    AS "documentType",
        sl.[Document No_]                     AS "documentNo",
        sl.[Line No_]                         AS "lineNo",
        sl.[Type]                             AS "type",
        sl.[No_]                              AS "no_",
        sl.[Customer Order Ref_]              AS "customerOrderRef",
        sl.[Reference]                        AS "reference",
        sl.[Gen_ Bus_ Posting Group]          AS "genBusPostingGroup",
        sl.[VAT Bus_ Posting Group]           AS "vatBusPostingGroup",
        sl.[Unit of Measure]                  AS "unitOfMeasure",
        sl.[Constant Variable Code]           AS "constantVariableCode",
        sl.[Assortment Code]                  AS "assortmentCode",
        sl.[Delete Reason]                    AS "deleteReason",
        sl.[Sales_Purchase Status Code]       AS "salesPurchaseStatusCode",
        sl.[Sales_Purchase Status - Item]     AS "salesPurchaseStatusItem",
        sl.[Delete Date]                      AS "deleteDate",
        sl.[Customer Price Group]             AS "customerPriceGroup",
        ISNULL(TRY_CAST(sl.[Average Unit Price]       AS FLOAT), 0) AS "averageUnitPrice",
        ISNULL(TRY_CAST(sl.[No_ of Pairs]             AS FLOAT), 0) AS "noOfPairs",
        ISNULL(TRY_CAST(sl.[Quantity]                 AS FLOAT), 0) AS "quantity",
        ISNULL(TRY_CAST(sl.[Line Amount]              AS FLOAT), 0) AS "lineAmount",
        ISNULL(TRY_CAST(sl.[Inv_ Discount Amount]     AS FLOAT), 0) AS "invDiscountAmount",
        ISNULL(TRY_CAST(sl.[Quantity Shipped]         AS FLOAT), 0) AS "quantityShipped",
        ISNULL(TRY_CAST(sl.[Quantity Invoiced]        AS FLOAT), 0) AS "quantityInvoiced",
        ISNULL(TRY_CAST(sl.[Return Qty_ Received]     AS FLOAT), 0) AS "returnQtyReceived",
        ISNULL(TRY_CAST(sl.[Subject 1 Commission _]   AS FLOAT), 0) AS "subject1Commission",
        ISNULL(TRY_CAST(sl.[Subject 2 Commission _]   AS FLOAT), 0) AS "subject2Commission",
        ISNULL(TRY_CAST(sl.[Subject 3 Commission _]   AS FLOAT), 0) AS "subject3Commission",
        ISNULL(TRY_CAST(sl.[Subject 4 Commission _]   AS FLOAT), 0) AS "subject4Commission",
        ISNULL(TRY_CAST(sl.[Area Manager Commission _] AS FLOAT), 0) AS "areaManagerCommission",
        ISNULL(TRY_CAST(sl.[Salesperson Commission _] AS FLOAT), 0) AS "salespersonCommission",
        sl.[Return Reason Code]               AS "returnReasonCode",
        sl.[Requested Delivery Date]          AS "requestedDeliveryDate",
        ISNULL(TRY_CAST(sl.[Line Discount _]  AS FLOAT), 0) AS "lineDiscountPct",
        ISNULL(TRY_CAST(sl.[Discount 1 _]     AS FLOAT), 0) AS "discount1Pct",
        ISNULL(TRY_CAST(sl.[Discount 2 _]     AS FLOAT), 0) AS "discount2Pct",
        ISNULL(TRY_CAST(sl.[Discount 3 _]     AS FLOAT), 0) AS "discount3Pct",
        sl.[Location Code]                    AS "locationCode",
        sl.[Model Cross Reference]            AS "modelCrossReference",
        sl.[Constant Assortment Var_Grp_]     AS "constantAssortmentVarGrp",
        CONVERT(BIGINT, sl.[timestamp])       AS "navRowversion"
      FROM [${co}$Sales Line] sl
      INNER JOIN [${co}$Sales Header] sh
        ON sl.[Document Type] = sh.[Document Type]
        AND sl.[Document No_] = sh.[No_]
      WHERE sl.[Type] IN (19, 20)
        AND sh.[Selling Season Code] IN (${inClause})
        AND CONVERT(BIGINT, sl.[timestamp]) > @rv
      ORDER BY sl.[timestamp]
    `);

    const rows = result.recordset;
    if (!rows.length) break;

    await bulkUpsert(prisma, TABLE, ['documentType', 'documentNo', 'lineNo'], rows);
    totalRows += rows.length;

    const maxRv = rows.reduce((m: bigint, r: Record<string, unknown>) => {
      const v = BigInt(r['navRowversion'] as number);
      return v > m ? v : m;
    }, lastRv);
    lastRv = maxRv;

    if (rows.length < SS_CHUNK) break;
  }

  const dur = Date.now() - t0;
  await updateSyncState(prisma, TABLE, lastRv, totalRows, dur);
  logger.debug({ table: TABLE, rows: totalRows, ms: dur }, 'nav-pf sync done');
  return { table: TABLE, rowsUpserted: totalRows, durationMs: dur };
}

async function syncSalesHeaderExt(
  pool: mssql.ConnectionPool,
  co: string,
  prisma: PrismaClient,
  seasons: string[],
  logger: Logger,
): Promise<TableSyncStats> {
  const TABLE = 'nav_pf_sales_header_ext';
  const t0 = Date.now();
  let totalRows = 0;
  let lastRv = await getLastRowversion(prisma, TABLE);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const req = pool.request();
    const inClause = bindSeasons(req, seasons);
    req.input('rv', mssql.BigInt, lastRv);

    const result = await req.query<Record<string, unknown>>(`
      SELECT TOP (${SS_CHUNK})
        she.[Document Type]             AS "documentType",
        she.[Document No_]              AS "documentNo",
        she.[Warehouse Speciality Code] AS "warehouseSpecialityCode",
        she.[Subject 3]                 AS "subject3",
        she.[Subject 4]                 AS "subject4",
        she.[Old Order No_]             AS "oldOrderNo",
        she.[Special Requests]          AS "specialRequests",
        CONVERT(BIGINT, she.[timestamp]) AS "navRowversion"
      FROM [${co}$Sales Header Extension] she
      INNER JOIN [${co}$Sales Header] sh
        ON she.[Document Type] = sh.[Document Type]
        AND she.[Document No_] = sh.[No_]
      WHERE sh.[Selling Season Code] IN (${inClause})
        AND CONVERT(BIGINT, she.[timestamp]) > @rv
      ORDER BY she.[timestamp]
    `);

    const rows = result.recordset;
    if (!rows.length) break;

    await bulkUpsert(prisma, TABLE, ['documentType', 'documentNo'], rows);
    totalRows += rows.length;

    const maxRv = rows.reduce((m: bigint, r: Record<string, unknown>) => {
      const v = BigInt(r['navRowversion'] as number);
      return v > m ? v : m;
    }, lastRv);
    lastRv = maxRv;

    if (rows.length < SS_CHUNK) break;
  }

  const dur = Date.now() - t0;
  await updateSyncState(prisma, TABLE, lastRv, totalRows, dur);
  logger.debug({ table: TABLE, rows: totalRows, ms: dur }, 'nav-pf sync done');
  return { table: TABLE, rowsUpserted: totalRows, durationMs: dur };
}

async function syncItems(
  pool: mssql.ConnectionPool,
  co: string,
  prisma: PrismaClient,
  logger: Logger,
): Promise<TableSyncStats> {
  const TABLE = 'nav_pf_item';
  const t0 = Date.now();
  let totalRows = 0;
  let lastRv = await getLastRowversion(prisma, TABLE);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const req = pool.request();
    req.input('rv', mssql.BigInt, lastRv);

    const result = await req.query<Record<string, unknown>>(`
      SELECT TOP (${SS_CHUNK})
        i.[No_]                              AS "no_",
        i.[Description]                      AS "description",
        i.[Description 2]                    AS "description2",
        i.[Configurator Relation]            AS "configuratorRelation",
        i.[Model Item No_]                   AS "modelItemNo",
        i.[Variable Code 01]                 AS "variableCode01",
        i.[Smu]                              AS "smu",
        i.[Carry Over]                       AS "carryOver",
        i.[Future Carry Over]                AS "futureCarryOver",
        i.[Sold Out]                         AS "soldOut",
        i.[Sold Out Date]                    AS "soldOutDate",
        i.[Sales_Purchase Status - Item]     AS "salesPurchaseStatusItem",
        i.[Sales_Purchase Status Date]       AS "salesPurchaseStatusDate",
        i.[Potential Sold Out]               AS "potentialSoldOut",
        ISNULL(TRY_CAST(i.[Minimum Order Quantity] AS FLOAT), 0) AS "minimumOrderQuantity",
        i.[Must Buy]                         AS "mustBuy",
        ISNULL(TRY_CAST(i.[Standard Cost]   AS FLOAT), 0) AS "standardCost",
        i.[Collection Code]                  AS "collectionCode",
        i.[Line Code]                        AS "lineCode",
        i.[Season Typology]                  AS "seasonTypology",
        i.[Product Family]                   AS "productFamily",
        i.[Product Sex]                      AS "productSex",
        i.[Shipment Priority]                AS "shipmentPriority",
        i.[Innovation Degree]                AS "innovationDegree",
        i.[Heel Height]                      AS "heelHeight",
        i.[End Customer Price Gap]           AS "endCustomerPriceGap",
        i.[Market Segment]                   AS "marketSegment",
        i.[Product Typology]                 AS "productTypology",
        i.[Main Material]                    AS "mainMaterial",
        i.[Sole Material]                    AS "soleMaterial",
        i.[Vendor No_]                       AS "vendorNo",
        i.[Manufacturer]                     AS "manufacturer",
        i.[Advertising Material]             AS "advertisingMaterial",
        i.[Country_Region of Origin Code]    AS "countryRegionOfOriginCode",
        i.[Constant Assortment Var_Grp_]     AS "constantAssortmentVarGrp",
        i.[Season Code]                      AS "seasonCode",
        i.[Trademark Code]                   AS "trademarkCode",
        CONVERT(BIGINT, i.[timestamp])       AS "navRowversion"
      FROM [${co}$Item] i
      WHERE (
        i.[Configurator Relation] IN (2, 3)
        OR EXISTS (
          SELECT 1 FROM [${co}$Sales Line] sl
          WHERE sl.[No_] = i.[No_]
            AND sl.[Type] IN (19, 20)
        )
      )
        AND CONVERT(BIGINT, i.[timestamp]) > @rv
      ORDER BY i.[timestamp]
    `);

    const rows = result.recordset;
    if (!rows.length) break;

    await bulkUpsert(prisma, TABLE, ['no_'], rows);
    totalRows += rows.length;

    const maxRv = rows.reduce((m: bigint, r: Record<string, unknown>) => {
      const v = BigInt(r['navRowversion'] as number);
      return v > m ? v : m;
    }, lastRv);
    lastRv = maxRv;

    if (rows.length < SS_CHUNK) break;
  }

  const dur = Date.now() - t0;
  await updateSyncState(prisma, TABLE, lastRv, totalRows, dur);
  logger.debug({ table: TABLE, rows: totalRows, ms: dur }, 'nav-pf sync done');
  return { table: TABLE, rowsUpserted: totalRows, durationMs: dur };
}

async function syncCustomers(
  pool: mssql.ConnectionPool,
  co: string,
  prisma: PrismaClient,
  logger: Logger,
): Promise<TableSyncStats> {
  const TABLE = 'nav_pf_customer';
  const t0 = Date.now();
  let totalRows = 0;
  let lastRv = await getLastRowversion(prisma, TABLE);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const req = pool.request();
    req.input('rv', mssql.BigInt, lastRv);

    const result = await req.query<Record<string, unknown>>(`
      SELECT TOP (${SS_CHUNK})
        c.[No_]                          AS "no_",
        c.[Name]                         AS "name",
        c.[Name 2]                       AS "name2",
        c.[Address]                      AS "address",
        c.[City]                         AS "city",
        c.[Post Code]                    AS "postCode",
        c.[County]                       AS "county",
        c.[Country_Region Code]          AS "countryRegionCode",
        c.[Phone No_]                    AS "phoneNo",
        c.[Fax No_]                      AS "faxNo",
        c.[E-Mail]                       AS "eMail",
        c.[Business E-Mail]              AS "businessEMail",
        c.[Contact]                      AS "contact",
        c.[Geographical Zone]            AS "geographicalZone",
        c.[Geographical Zone 2]          AS "geographicalZone2",
        c.[Key Account]                  AS "keyAccount",
        c.[Warehouse Speciality Code]    AS "warehouseSpecialityCode",
        c.[Language Code]                AS "languageCode",
        c.[Fast Shipment]                AS "fastShipment",
        c.[Blocked for Assignments]      AS "blockedForAssignments",
        c.[Reason Block Code]            AS "reasonBlockCode",
        c.[Payment Method Code]          AS "paymentMethodCode",
        c.[Payment Terms Code]           AS "paymentTermsCode",
        c.[VAT Registration No_]         AS "vatRegistrationNo",
        c.[Fiscal Code]                  AS "fiscalCode",
        c.[Current Risk]                 AS "currentRisk",
        c.[Risk Rating]                  AS "riskRating",
        c.[PM Failure Assigned Score]    AS "pmFailureAssignedScore",
        c.[Updated Date]                 AS "updatedDate",
        c.[Updated Type]                 AS "updatedType",
        c.[Due Date]                     AS "dueDate",
        c.[Internal Valuation]           AS "internalValuation",
        c.[Valuation Date]               AS "valuationDate",
        c.[Reservation Priority]         AS "reservationPriority",
        ISNULL(TRY_CAST(c.[Authorized Stores Number] AS INT), 0) AS "authorizedStoresNumber",
        c.[Store Distribution]           AS "storeDistribution",
        c.[Store Image]                  AS "storeImage",
        c.[Store Type]                   AS "storeType",
        c.[Various References]           AS "variousReferences",
        c.[Home Page]                    AS "homePage",
        c.[Quality Control]              AS "qualityControl",
        c.[Old Febos No_]                AS "oldFebosNo",
        c.[Old Bridge No_]               AS "oldBridgeNo",
        c.[Purchase Group]               AS "purchaseGroup",
        c.[Distribution Channel]         AS "distributionChannel",
        c.[Credit Manager]               AS "creditManager",
        c.[EAC Labels]                   AS "eacLabels",
        c.[Sovracollo Completo]          AS "sovracolloCompleto",
        c.[Commission Group Code]        AS "commissionGroupCode",
        c.[VAT Bus_ Posting Group]       AS "vatBusPostingGroup",
        c.[Gen_ Bus_ Posting Group]      AS "genBusPostingGroup",
        c.[Customer Posting Group]       AS "customerPostingGroup",
        CONVERT(BIGINT, c.[timestamp])   AS "navRowversion"
      FROM [${co}$Customer] c
      WHERE CONVERT(BIGINT, c.[timestamp]) > @rv
      ORDER BY c.[timestamp]
    `);

    const rows = result.recordset;
    if (!rows.length) break;

    await bulkUpsert(prisma, TABLE, ['no_'], rows);
    totalRows += rows.length;

    const maxRv = rows.reduce((m: bigint, r: Record<string, unknown>) => {
      const v = BigInt(r['navRowversion'] as number);
      return v > m ? v : m;
    }, lastRv);
    lastRv = maxRv;

    if (rows.length < SS_CHUNK) break;
  }

  const dur = Date.now() - t0;
  await updateSyncState(prisma, TABLE, lastRv, totalRows, dur);
  logger.debug({ table: TABLE, rows: totalRows, ms: dur }, 'nav-pf sync done');
  return { table: TABLE, rowsUpserted: totalRows, durationMs: dur };
}

// ─── Lookup tables (full sync ogni ciclo) ─────────────────────────────────────

async function syncLookup<T extends Record<string, unknown>>(
  pool: mssql.ConnectionPool,
  co: string,
  prisma: PrismaClient,
  navTable: string,
  pgTable: string,
  pk: readonly string[],
  selectSql: string,
  logger: Logger,
): Promise<TableSyncStats> {
  const t0 = Date.now();
  const req = pool.request();
  const result = await req.query<T>(`SELECT ${selectSql} FROM [${co}$${navTable}]`);
  const rows = result.recordset as Record<string, unknown>[];
  await bulkUpsert(prisma, pgTable, pk, rows);
  const dur = Date.now() - t0;
  await updateSyncState(prisma, pgTable, BigInt(0), rows.length, dur);
  logger.debug({ table: pgTable, rows: rows.length, ms: dur }, 'nav-pf sync done');
  return { table: pgTable, rowsUpserted: rows.length, durationMs: dur };
}

async function syncShipToAddress(
  pool: mssql.ConnectionPool,
  co: string,
  prisma: PrismaClient,
  logger: Logger,
): Promise<TableSyncStats> {
  const TABLE = 'nav_pf_ship_to_address';
  const t0 = Date.now();
  let totalRows = 0;
  let lastRv = await getLastRowversion(prisma, TABLE);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const req = pool.request();
    req.input('rv', mssql.BigInt, lastRv);

    const result = await req.query<Record<string, unknown>>(`
      SELECT TOP (${SS_CHUNK})
        sta.[Customer No_]              AS "customerNo",
        sta.[Code]                      AS "code",
        sta.[Geographical Zone 2]       AS "geographicalZone2",
        sta.[Country_Region Code]       AS "countryRegionCode",
        CONVERT(BIGINT, sta.[timestamp]) AS "navRowversion"
      FROM [${co}$Ship-to Address] sta
      WHERE CONVERT(BIGINT, sta.[timestamp]) > @rv
      ORDER BY sta.[timestamp]
    `);

    const rows = result.recordset;
    if (!rows.length) break;

    await bulkUpsert(prisma, TABLE, ['customerNo', 'code'], rows);
    totalRows += rows.length;

    const maxRv = rows.reduce((m: bigint, r: Record<string, unknown>) => {
      const v = BigInt(r['navRowversion'] as number);
      return v > m ? v : m;
    }, lastRv);
    lastRv = maxRv;

    if (rows.length < SS_CHUNK) break;
  }

  const dur = Date.now() - t0;
  await updateSyncState(prisma, TABLE, lastRv, totalRows, dur);
  logger.debug({ table: TABLE, rows: totalRows, ms: dur }, 'nav-pf sync done');
  return { table: TABLE, rowsUpserted: totalRows, durationMs: dur };
}

// ─── Pre-aggregated tables (full-refresh scoped ai doc_nos attivi) ─────────────

async function syncDatePrenotazione(
  pool: mssql.ConnectionPool,
  co: string,
  prisma: PrismaClient,
  logger: Logger,
): Promise<TableSyncStats> {
  const TABLE = 'nav_pf_date_prenotazione';
  const t0 = Date.now();

  // Prende i document nos dalle sales_header già sincronizzate
  const headers = await prisma.navPfSalesHeader.findMany({ select: { no_: true } });
  if (!headers.length) {
    return { table: TABLE, rowsUpserted: 0, durationMs: 0 };
  }

  // Batch da 2000 per la IN clause su SQL Server
  const DOC_BATCH = 2_000;
  const docNos = headers.map(h => h.no_);
  let totalRows = 0;

  for (let i = 0; i < docNos.length; i += DOC_BATCH) {
    const batch = docNos.slice(i, i + DOC_BATCH);
    const req = pool.request();
    batch.forEach((no, j) => req.input(`d${j}`, mssql.NVarChar(20), no));
    const inClause = batch.map((_, j) => `@d${j}`).join(', ');

    const result = await req.query<Record<string, unknown>>(`
      SELECT
        ral.[Sales Document No_] AS "salesDocumentNo",
        ral.[Sales Line No_]     AS "salesLineNo",
        MAX(ral.[Date Reservation]) AS "dateReservation"
      FROM [${co}$Reserv__Assign_ Link] ral
      WHERE ral.[Reserv__Assign_ Type] = 1
        AND ral.[Sales Document No_] IN (${inClause})
      GROUP BY ral.[Sales Document No_], ral.[Sales Line No_]
    `);

    const rows = result.recordset as Record<string, unknown>[];
    if (rows.length) {
      await bulkUpsert(prisma, TABLE, ['salesDocumentNo', 'salesLineNo'], rows);
      totalRows += rows.length;
    }
  }

  const dur = Date.now() - t0;
  logger.debug({ table: TABLE, rows: totalRows, ms: dur }, 'nav-pf sync done');
  return { table: TABLE, rowsUpserted: totalRows, durationMs: dur };
}

async function syncDdtPicking(
  pool: mssql.ConnectionPool,
  co: string,
  prisma: PrismaClient,
  logger: Logger,
): Promise<TableSyncStats> {
  const TABLE = 'nav_pf_ddt_picking';
  const t0 = Date.now();

  const headers = await prisma.navPfSalesHeader.findMany({ select: { no_: true } });
  if (!headers.length) {
    return { table: TABLE, rowsUpserted: 0, durationMs: 0 };
  }

  const DOC_BATCH = 2_000;
  const docNos = headers.map(h => h.no_);
  let totalRows = 0;

  for (let i = 0; i < docNos.length; i += DOC_BATCH) {
    const batch = docNos.slice(i, i + DOC_BATCH);
    const req = pool.request();
    batch.forEach((no, j) => req.input(`d${j}`, mssql.NVarChar(20), no));
    const inClause = batch.map((_, j) => `@d${j}`).join(', ');

    const result = await req.query<Record<string, unknown>>(`
      SELECT
        dpl.[Order No_]      AS "orderNo",
        dpl.[Order Line No_] AS "orderLineNo",
        SUM(ISNULL(TRY_CAST(dpl.[No_ of Pairs] AS FLOAT), 0))                                   AS "pairsTotale",
        SUM(ISNULL(TRY_CAST(dpl.[Quantity]      AS FLOAT), 0))                                   AS "qtyTotale",
        SUM(CASE WHEN dph.[Status] = 1  THEN ISNULL(TRY_CAST(dpl.[No_ of Pairs] AS FLOAT), 0) ELSE 0 END) AS "pairsRilasciate",
        SUM(CASE WHEN dph.[Status] = 1  THEN ISNULL(TRY_CAST(dpl.[Quantity]      AS FLOAT), 0) ELSE 0 END) AS "qtyRilasciate",
        SUM(CASE WHEN dph.[Status] = 0  THEN ISNULL(TRY_CAST(dpl.[No_ of Pairs] AS FLOAT), 0) ELSE 0 END) AS "pairsAperte",
        SUM(CASE WHEN dph.[Status] = 0  THEN ISNULL(TRY_CAST(dpl.[Quantity]      AS FLOAT), 0) ELSE 0 END) AS "qtyAperte",
        SUM(CASE WHEN dph.[Status] = 41 THEN ISNULL(TRY_CAST(dpl.[No_ of Pairs] AS FLOAT), 0) ELSE 0 END) AS "pairsDaInviareWmsps",
        SUM(CASE WHEN dph.[Status] = 41 THEN ISNULL(TRY_CAST(dpl.[Quantity]      AS FLOAT), 0) ELSE 0 END) AS "qtyDaInviareWmsps",
        SUM(CASE WHEN dph.[Status] = 42 THEN ISNULL(TRY_CAST(dpl.[No_ of Pairs] AS FLOAT), 0) ELSE 0 END) AS "pairsInviatoWmsps",
        SUM(CASE WHEN dph.[Status] = 42 THEN ISNULL(TRY_CAST(dpl.[Quantity]      AS FLOAT), 0) ELSE 0 END) AS "qtyInviatoWmsps",
        SUM(CASE WHEN dph.[Status] = 43 THEN ISNULL(TRY_CAST(dpl.[No_ of Pairs] AS FLOAT), 0) ELSE 0 END) AS "pairsEvasoWmsps",
        SUM(CASE WHEN dph.[Status] = 43 THEN ISNULL(TRY_CAST(dpl.[Quantity]      AS FLOAT), 0) ELSE 0 END) AS "qtyEvasoWmsps"
      FROM [${co}$DDT_Picking Line] dpl
      INNER JOIN [${co}$DDT_Picking Header] dph
        ON dpl.[Document Type] = dph.[Document Type]
        AND dpl.[Document No_] = dph.[No_]
      WHERE dpl.[Type] IN (19, 20)
        AND dph.[Document Type] = 0
        AND dph.[Status] IN (0, 1, 41, 42, 43)
        AND dpl.[Order No_] IN (${inClause})
      GROUP BY dpl.[Order No_], dpl.[Order Line No_]
    `);

    const rows = result.recordset as Record<string, unknown>[];
    if (rows.length) {
      await bulkUpsert(prisma, TABLE, ['orderNo', 'orderLineNo'], rows);
      totalRows += rows.length;
    }
  }

  const dur = Date.now() - t0;
  logger.debug({ table: TABLE, rows: totalRows, ms: dur }, 'nav-pf sync done');
  return { table: TABLE, rowsUpserted: totalRows, durationMs: dur };
}

// ─── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Esegue un ciclo completo di sync NAV → PG per le tabelle portafoglio.
 *
 * @param pool     Pool mssql già connesso
 * @param company  Nome company NAV grezzo (es. 'NewEra') — sanitizzato internamente
 * @param prisma   PrismaClient
 * @param logger   Logger Pino
 */
export async function syncPortafoglioNow(
  pool: mssql.ConnectionPool,
  company: string,
  prisma: PrismaClient,
  logger: Logger,
): Promise<PortafoglioSyncResult> {
  const t0 = Date.now();
  const co = sanitizeCompany(company);
  const log = logger.child({ service: 'nav-portafoglio-sync' });

  // Stagioni attive dal DB locale
  const activeSeasonsRaw = await prisma.season.findMany({
    where: { isActive: true },
    select: { code: true },
    orderBy: { code: 'desc' },
  });
  const seasonCodes = activeSeasonsRaw.map(s => s.code);

  if (!seasonCodes.length) {
    log.warn('Nessuna stagione attiva — sync portafoglio saltata');
    return { stats: [], totalDurationMs: 0, seasonCodes: [], error: 'Nessuna stagione attiva' };
  }

  log.info({ seasonCodes }, 'nav-pf sync start');
  const stats: TableSyncStats[] = [];

  try {
    // 1. Sales Header prima (gli altri dipendono dai doc_nos)
    stats.push(await syncSalesHeader(pool, co, prisma, seasonCodes, log));

    // 2. Tabelle dipendenti da Sales Header + tabelle indipendenti (in parallelo)
    const parallel = await Promise.allSettled([
      syncSalesLines(pool, co, prisma, seasonCodes, log),
      syncSalesHeaderExt(pool, co, prisma, seasonCodes, log),
      syncItems(pool, co, prisma, log),
      syncCustomers(pool, co, prisma, log),
      syncShipToAddress(pool, co, prisma, log),
      // Lookup tables via generic helper
      syncLookup(pool, co, prisma, 'Salesperson_Purchaser', 'nav_pf_salesperson', ['code'] as const,
        `[Code] AS "code", [Name] AS "name", CONVERT(BIGINT, [timestamp]) AS "navRowversion"`, log),
      syncLookup(pool, co, prisma, 'Variable Code', 'nav_pf_variable_code', ['variableGroup', 'variableCode'] as const,
        `[Variable Group] AS "variableGroup", [Variable Code] AS "variableCode", [Description] AS "description", CONVERT(BIGINT, [timestamp]) AS "navRowversion"`, log),
      syncLookup(pool, co, prisma, 'Geographical Zone', 'nav_pf_geo_zone', ['code'] as const,
        `[Code] AS "code", [Description] AS "description", CONVERT(BIGINT, [timestamp]) AS "navRowversion"`, log),
      syncLookup(pool, co, prisma, 'Shipment Method', 'nav_pf_shipment_method', ['code'] as const,
        `[Code] AS "code", [Description] AS "description", CONVERT(BIGINT, [timestamp]) AS "navRowversion"`, log),
      syncLookup(pool, co, prisma, 'Transport Reason Code', 'nav_pf_transport_reason', ['code'] as const,
        `[Code] AS "code", [Description] AS "description", CONVERT(BIGINT, [timestamp]) AS "navRowversion"`, log),
      syncLookup(pool, co, prisma, 'Budget Header', 'nav_pf_budget_header', ['no_'] as const,
        `[No_] AS "no_", [Budget Area] AS "budgetArea", CONVERT(BIGINT, [timestamp]) AS "navRowversion"`, log),
      syncLookup(pool, co, prisma, 'Vendor', 'nav_pf_vendor', ['no_'] as const,
        `[No_] AS "no_", [Name] AS "name", CONVERT(BIGINT, [timestamp]) AS "navRowversion"`, log),
    ]);

    for (const r of parallel) {
      if (r.status === 'fulfilled') {
        stats.push(r.value);
      } else {
        log.error({ err: r.reason }, 'nav-pf parallel sync error');
      }
    }

    // 3. Pre-aggregated (dipendono da nav_pf_sales_header popolata)
    const [prenotDate, ddt] = await Promise.allSettled([
      syncDatePrenotazione(pool, co, prisma, log),
      syncDdtPicking(pool, co, prisma, log),
    ]);
    if (prenotDate.status === 'fulfilled') stats.push(prenotDate.value);
    else log.error({ err: prenotDate.reason }, 'nav-pf date_prenotazione sync error');
    if (ddt.status === 'fulfilled') stats.push(ddt.value);
    else log.error({ err: ddt.reason }, 'nav-pf ddt_picking sync error');

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'nav-pf sync fatal error');
    return { stats, totalDurationMs: Date.now() - t0, seasonCodes, error: msg };
  }

  const total = Date.now() - t0;
  const totalRows = stats.reduce((s, x) => s + x.rowsUpserted, 0);
  log.info({ totalRows, ms: total, tables: stats.length }, 'nav-pf sync completed');

  return { stats, totalDurationMs: total, seasonCodes };
}
