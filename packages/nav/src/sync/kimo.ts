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

import { sanitizeCompany } from '../config.js';

import { SS_CHUNK, syncIncremental, type TableSyncStats } from './pgUpsert.js';

import type { PrismaClient } from '@prisma/client';
import type mssql from 'mssql';
import type { Logger } from 'pino';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface KimoSyncResult {
  stats: TableSyncStats[];
  totalDurationMs: number;
  error?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Le tabelle kimo hanno PK BIGINT oltre al rowversion. */
const KIMO_BIGINT_COLS = ['navRowversion', 'entryNo', 'headerEntryNo'] as const;

// ─── Per-table sync functions ─────────────────────────────────────────────────

function syncKimoSalesHeader(
  pool: mssql.ConnectionPool,
  co: string,
  prisma: PrismaClient,
  logger: Logger,
): Promise<TableSyncStats> {
  return syncIncremental(pool, prisma, logger, {
    table: 'nav_kimo_sales_header',
    pk: ['entryNo'],
    bigintCols: KIMO_BIGINT_COLS,
    buildQuery: () => `
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
    `,
  });
}

function syncKimoSalesLines(
  pool: mssql.ConnectionPool,
  co: string,
  prisma: PrismaClient,
  logger: Logger,
): Promise<TableSyncStats> {
  return syncIncremental(pool, prisma, logger, {
    table: 'nav_kimo_sales_line',
    pk: ['entryNo'],
    bigintCols: KIMO_BIGINT_COLS,
    buildQuery: () => `
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
    `,
  });
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
