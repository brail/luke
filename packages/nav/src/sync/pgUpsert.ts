import mssql from 'mssql';

import { createSyncRequest } from './utils.js';

import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

/**
 * Shared upsert/watermark helpers for the nav-pf and nav-kimo PostgreSQL replica sync jobs.
 * Both jobs write into local `nav_pf_*` / `nav_kimo_*` tables using the same
 * generic bulk-upsert + rowversion-watermark pattern.
 */

export interface TableSyncStats {
  table: string;
  rowsUpserted: number;
  durationMs: number;
}

const PG_BATCH = 500;

/** Righe per SELECT su SQL Server per ciclo (chunking). */
export const SS_CHUNK = 3_000;

/**
 * Bulk upsert generico via raw SQL.
 * I column names sono controllati internamente (non input utente): $executeRawUnsafe è sicuro.
 * Le colonne PK non vengono incluse nel DO UPDATE SET.
 *
 * @param bigintCols - Colonne che PG si aspetta come BIGINT: mssql le restituisce
 *   come stringa/numero JS, qui vengono convertite a BigInt. Dichiarate dal caller
 *   perché dipendono dalla tabella (es. kimo: entryNo/headerEntryNo).
 */
export async function bulkUpsert(
  prisma: PrismaClient,
  table: string,
  pk: readonly string[],
  rows: Record<string, unknown>[],
  bigintCols: readonly string[] = ['navRowversion'],
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
        if (bigintCols.includes(c) && (typeof val === 'string' || typeof val === 'number')) {
          val = BigInt(val);
        }
        params.push(val);
        return `$${params.length}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    // nosemgrep: luke-prisma-raw-unsafe -- identificatori (table/colonne) controllati internamente dal caller, mai da input utente; valori sempre parametrizzati ($1, $2...)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${table}" (${colList}) VALUES ${vals.join(', ')} ON CONFLICT (${pkList}) DO UPDATE SET ${setList}`,
      ...params,
    );
  }
}

export async function getLastRowversion(prisma: PrismaClient, tableName: string): Promise<bigint> {
  const s = await prisma.navPfSyncState.findUnique({ where: { tableName } });
  return s?.lastRowversion ?? BigInt(0);
}

export async function updateSyncState(
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

/** Spec di una tabella replicata incrementalmente via rowversion watermark. */
export interface IncrementalSyncSpec {
  /** Nome tabella PG di destinazione (usato anche come chiave in nav_pf_sync_state). */
  table: string;
  pk: readonly string[];
  /**
   * Binds any extra params on the request and returns the full SELECT statement.
   * The statement must page with `TOP (${SS_CHUNK})`, filter on `> @rv` (bound by
   * the loop) and `ORDER BY [timestamp]` ascending.
   */
  buildQuery: (req: mssql.Request) => string;
  /** Colonne BIGINT per bulkUpsert (default: ['navRowversion']). */
  bigintCols?: readonly string[];
}

/**
 * Shared chunked-watermark loop for all incremental replica tables:
 * reads SQL Server pages of SS_CHUNK rows above the last rowversion, bulk-upserts
 * them into PG, advances the watermark, and persists the sync state at the end.
 */
export async function syncIncremental(
  pool: mssql.ConnectionPool,
  prisma: PrismaClient,
  logger: Logger,
  spec: IncrementalSyncSpec,
): Promise<TableSyncStats> {
  const { table, pk, buildQuery, bigintCols } = spec;
  const t0 = Date.now();
  let totalRows = 0;
  let lastRv = await getLastRowversion(prisma, table);

  while (true) {
    const req = createSyncRequest(pool);
    const sql = buildQuery(req);
    req.input('rv', mssql.BigInt, lastRv);

    const result = await req.query<Record<string, unknown>>(sql);
    const rows = result.recordset;
    if (!rows.length) break;

    await bulkUpsert(prisma, table, pk, rows, bigintCols);
    totalRows += rows.length;

    // Le righe sono ordinate per [timestamp] ASC: l'ultima contiene il max rowversion.
    lastRv = BigInt(rows[rows.length - 1]!['navRowversion'] as string | number);

    if (rows.length < SS_CHUNK) break;
  }

  const dur = Date.now() - t0;
  await updateSyncState(prisma, table, lastRv, totalRows, dur);
  logger.debug({ table, rows: totalRows, ms: dur }, 'nav replica sync done');
  return { table, rowsUpserted: totalRows, durationMs: dur };
}
