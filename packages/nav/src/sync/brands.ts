import { sanitizeCompany } from '../config.js';

import { buildNavSyncFilter, buildWhereClause, createSyncRequest, processInBatches } from './utils.js';

import type { NavDbConfig } from '../config.js';
import type { SyncResult } from './vendors.js';
import type { PrismaClient, Prisma } from '@prisma/client';
import type mssql from 'mssql';
import type { Logger } from 'pino';

const UPSERT_BATCH_SIZE = 100;

/**
 * Syncs `[COMPANY$Brand]` from NAV into the `nav_brands` Postgres table,
 * and creates or updates the corresponding local `Brand` record.
 *
 * Always performs a full sync (no differential watermark) because the NAV
 * Brand table exposes only a SQL Server `rowversion` (binary), not a
 * modification date. The table is typically small (<200 rows).
 *
 * Local `Brand` records that already exist with the same code but no NAV
 * link are skipped (not auto-created); the user must link them manually.
 * Only `name` is updated on existing local brands — `isActive`, `logoUrl`,
 * and other enriched fields are never touched.
 *
 * @returns `SyncResult` with the count of successfully upserted records
 */
export async function syncBrands(
  pool: mssql.ConnectionPool,
  prisma: PrismaClient,
  config: NavDbConfig,
  logger: Logger,
): Promise<SyncResult> {
  const entity = 'brand';

  const filter = await prisma.navSyncFilter.findUnique({ where: { entity } });
  const filterResult = buildNavSyncFilter(filter, logger, entity, 'Code');

  if (filterResult.shouldSkip) {
    return { entity, upserted: 0, skipped: true, filterMode: filterResult.filterMode };
  }

  const { filterMode, filterPredicates, bindParams } = filterResult;
  const whereClause = buildWhereClause(filterPredicates);

  const tableName = `[${sanitizeCompany(config.company)}$Brand]`;
  const request = createSyncRequest(pool);
  bindParams(request);

  const result = await request.query<{
    'Code': string;
    'Description': string | null;
  }>(`SELECT [Code], [Description] FROM ${tableName} ${whereClause}`);

  const rows = result.recordset;

  if (rows.length === 0) {
    logger.info({ entity, filterMode, upserted: 0 }, 'NAV sync: no records to update');
    return { entity, upserted: 0, skipped: false, filterMode };
  }

  const syncedAt = new Date();

  let errors = 0;
  await processInBatches(rows, UPSERT_BATCH_SIZE, async row => {
    const navCode = row['Code'];
    const description = row['Description'] ?? '';

    try {
      // Atomic: NAV replica + local master data in a single transaction.
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.navBrand.upsert({
          where: { navCode },
          create: { navCode, description, syncedAt },
          update: { description, syncedAt },
        });

        // Guard: if a local brand already exists with the same code but no NAV link,
        // do not auto-create — the user must link it manually.
        const localConflict = await tx.brand.findFirst({
          where: { code: navCode, navBrandId: null },
          select: { id: true },
        });
        if (localConflict) {
          logger.warn({ entity, navCode }, 'NAV sync: local brand with same code without NAV link — skip auto-create');
          return;
        }

        // Upsert local brand: create if not exist, update only name.
        // NEVER touch isActive or logoUrl or other enriched fields.
        await tx.brand.upsert({
          where: { navBrandId: navCode },
          create: { code: navCode, name: description, navBrandId: navCode, isActive: true },
          update: { name: description },
        });
      });
    } catch (err) {
      errors++;
      logger.error({ entity, navCode, err }, 'NAV sync: errore upsert brand');
    }
  });

  logger.info({ entity, filterMode, upserted: rows.length, errors }, 'NAV sync: completato');
  return { entity, upserted: rows.length - errors, skipped: false, filterMode };
}
