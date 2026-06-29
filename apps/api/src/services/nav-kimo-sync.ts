/**
 * NAV → PostgreSQL sync for KIMO-FASHION tables.
 *
 * Strategy per table:
 *  - KIMO-FASHION Sales Order Hdr / Line: incremental via SQL Server rowversion.
 *    No season filter: all basket records are replicated (baskets lack a season field).
 *  - Lookup tables (e.g. AssortimentiQuantita): full-sync each cycle (small tables).
 *
 * Designed to run every N minutes as a background job.
 * Uses nav_pf_sync_state for tracking (same schema, "nav_kimo_*" table names).
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

export interface KimoSyncResult {
  stats: TableSyncStats[];
  totalDurationMs: number;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Righe per SELECT su SQL Server per ciclo (chunking). */
const SS_CHUNK = 3_000;

/** Righe per INSERT batch su PG. */
const PG_BATCH = 500;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Generic bulk upsert via raw SQL. Column names are controlled internally (not user input),
 * making $executeRawUnsafe safe here. PK columns are excluded from DO UPDATE SET.
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
  if (nonPk.length === 0) return;

  const colList = cols.map(c => `"${c}"`).join(', ');
  const pkList  = pk.map(c => `"${c}"`).join(', ');
  const setList = nonPk.map(c => `"${c}" = EXCLUDED."${c}"`).join(', ');

  for (let i = 0; i < rows.length; i += PG_BATCH) {
    const chunk = rows.slice(i, i + PG_BATCH);
    const params: unknown[] = [];
    const vals = chunk.map(row => {
      const placeholders = cols.map(c => {
        let val = row[c] ?? null;
        if (c === 'navRowversion' && (typeof val === 'string' || typeof val === 'number')) val = BigInt(val as string | number);
        if ((c === 'entryNo' || c === 'headerEntryNo') && (typeof val === 'string' || typeof val === 'number')) val = BigInt(val as string | number);
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

// ─── Per-table sync functions ─────────────────────────────────────────────────

async function syncKimoSalesHeader(
  pool: mssql.ConnectionPool,
  co: string,
  prisma: PrismaClient,
  logger: Logger,
): Promise<TableSyncStats> {
  const TABLE = 'nav_kimo_sales_header';
  const t0 = Date.now();
  let totalRows = 0;
  let lastRv = await getLastRowversion(prisma, TABLE);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const req = pool.request();
    req.input('rv', mssql.BigInt, lastRv);

    const result = await req.query<Record<string, unknown>>(`
      SELECT TOP (${SS_CHUNK})
        kh.[Entry No_]                       AS "entryNo",
        kh.[Trademark Code]                  AS "trademarkCode",
        kh.[Selling Season Code]             AS "sellingSeasonCode",
        kh.[Salesperson Code NAV]            AS "salespersonCodeNav",
        kh.[Assigned Sales Document No_]     AS "assignedSalesDocumentNo",
        kh.[Sell-to Customer No_]            AS "sellToCustomerNo",
        kh.[Create SO Date Time]             AS "createSoDateTime",
        kh.[Release SO Date Time]            AS "releaseSoDateTime",
        kh.[KIMO Document Type]              AS "kimoDocumentType",
        CONVERT(BIGINT, kh.[timestamp])      AS "navRowversion"
      FROM [${co}$KIMO-FASHION Sales Order Hdr] kh
      WHERE CONVERT(BIGINT, kh.[timestamp]) > @rv
      ORDER BY kh.[timestamp]
    `);

    const rows = result.recordset;
    if (!rows.length) break;

    await bulkUpsert(prisma, TABLE, ['entryNo'], rows);
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
  logger.debug({ table: TABLE, rows: totalRows, ms: dur }, 'nav-kimo sync done');
  return { table: TABLE, rowsUpserted: totalRows, durationMs: dur };
}

async function syncKimoSalesLines(
  pool: mssql.ConnectionPool,
  co: string,
  prisma: PrismaClient,
  logger: Logger,
): Promise<TableSyncStats> {
  const TABLE = 'nav_kimo_sales_line';
  const t0 = Date.now();
  let totalRows = 0;
  let lastRv = await getLastRowversion(prisma, TABLE);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const req = pool.request();
    req.input('rv', mssql.BigInt, lastRv);

    const result = await req.query<Record<string, unknown>>(`
      SELECT TOP (${SS_CHUNK})
        kl.[Entry No_]                       AS "entryNo",
        kl.[Header Entry No_]                AS "headerEntryNo",
        kl.[No_]                             AS "no_",
        kl.[Model Item No_]                  AS "modelItemNo",
        kl.[Color Code]                      AS "colorCode",
        kl.[Size Code]                       AS "sizeCode",
        ISNULL(TRY_CAST(kl.[Quantity]        AS FLOAT), 0) AS "quantity",
        ISNULL(TRY_CAST(kl.[Line Amount]     AS FLOAT), 0) AS "lineAmount",
        kl.[KIMO_FASHION SO Reference]       AS "kimoFashionSoReference",
        kl.[Type]                            AS "type",
        CONVERT(BIGINT, kl.[timestamp])      AS "navRowversion"
      FROM [${co}$KIMO-FASHION Sales Order Line] kl
      WHERE CONVERT(BIGINT, kl.[timestamp]) > @rv
      ORDER BY kl.[timestamp]
    `);

    const rows = result.recordset;
    if (!rows.length) break;

    await bulkUpsert(prisma, TABLE, ['entryNo'], rows);
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
  logger.debug({ table: TABLE, rows: totalRows, ms: dur }, 'nav-kimo sync done');
  return { table: TABLE, rowsUpserted: totalRows, durationMs: dur };
}

// ─── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Runs a full NAV → PostgreSQL sync cycle for all KIMO-FASHION tables.
 * Syncs header table first (lines depend on it for logical integrity), then lines.
 *
 * @param pool - Already-connected mssql connection pool.
 * @param company - Raw NAV company name (e.g. 'NewEra') — sanitized internally.
 * @returns Sync stats per table plus total duration. Includes an error string on fatal failure.
 */
export async function syncKimoNow(
  pool: mssql.ConnectionPool,
  company: string,
  prisma: PrismaClient,
  logger: Logger,
): Promise<KimoSyncResult> {
  const t0 = Date.now();
  const co = sanitizeCompany(company);
  const log = logger.child({ service: 'nav-kimo-sync' });

  log.info('nav-kimo sync start');
  const stats: TableSyncStats[] = [];

  try {
    // Header prima (le lines dipendono dagli header per integrità logica)
    stats.push(await syncKimoSalesHeader(pool, co, prisma, log));

    // Lines
    stats.push(await syncKimoSalesLines(pool, co, prisma, log));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'nav-kimo sync fatal error');
    return {
      stats,
      totalDurationMs: Date.now() - t0,
      error: msg,
    };
  }

  const totalDurationMs = Date.now() - t0;
  log.info({ tables: stats.length, totalMs: totalDurationMs }, 'nav-kimo sync complete');
  return { stats, totalDurationMs };
}
