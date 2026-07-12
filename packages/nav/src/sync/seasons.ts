import { sanitizeCompany } from '../config.js';

import { buildNavSyncFilter, buildWhereClause, createSyncRequest, processInBatches } from './utils.js';

import type { NavDbConfig } from '../config.js';
import type { SyncResult } from './vendors.js';
import type { PrismaClient, Prisma } from '@prisma/client';
import type mssql from 'mssql';
import type { Logger } from 'pino';

const UPSERT_BATCH_SIZE = 100;

/**
 * Syncs `[COMPANY$Season]` from NAV into the `nav_seasons` Postgres table,
 * and creates or updates the corresponding local `Season` record.
 *
 * Always performs a full sync (no differential watermark) because the NAV
 * Season table exposes only a SQL Server `rowversion` (binary), not a
 * modification date. The table is typically small (<100 rows).
 *
 * Local `Season` records that already exist with the same code but no NAV
 * link are skipped (not auto-created); the user must link them manually.
 * Only `name` is updated on existing local seasons — `isActive` and other
 * enriched fields are never touched.
 *
 * @returns `SyncResult` with the count of successfully upserted records
 */
export async function syncSeasons(
  pool: mssql.ConnectionPool,
  prisma: PrismaClient,
  config: NavDbConfig,
  logger: Logger,
): Promise<SyncResult> {
  const entity = 'season';

  const filter = await prisma.navSyncFilter.findUnique({ where: { entity } });
  const filterResult = buildNavSyncFilter(filter, logger, entity, 'Code');

  if (filterResult.shouldSkip) {
    return { entity, upserted: 0, skipped: true, filterMode: filterResult.filterMode };
  }

  const { filterMode, filterPredicates, bindParams } = filterResult;
  const whereClause = buildWhereClause(filterPredicates);

  const tableName = `[${sanitizeCompany(config.company)}$Season]`;
  const request = createSyncRequest(pool);
  bindParams(request);

  const result = await request.query<{
    'Code': string;
    'Description': string | null;
    'Starting Date': Date | null;
    'Ending Date': Date | null;
  }>(`SELECT [Code], [Description], [Starting Date], [Ending Date] FROM ${tableName} ${whereClause}`);

  const rows = result.recordset;

  if (rows.length === 0) {
    logger.info({ entity, filterMode, upserted: 0 }, 'NAV sync: nessun record da aggiornare');
    return { entity, upserted: 0, skipped: false, filterMode };
  }

  const syncedAt = new Date();

  let errors = 0;
  await processInBatches(rows, UPSERT_BATCH_SIZE, async row => {
    const navCode = row['Code'];
    const description = row['Description'] ?? '';
    const startingDate = row['Starting Date'] ?? null;
    const endingDate = row['Ending Date'] ?? null;

    try {
      // Atomico: replica NAV + anagrafica locale in un'unica transaction.
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.navSeason.upsert({
          where: { navCode },
          create: { navCode, description, startingDate, endingDate, syncedAt },
          update: { description, startingDate, endingDate, syncedAt },
        });

        // Guard: se esiste già una season locale con lo stesso code ma senza collegamento NAV,
        // non auto-creare — l'utente deve collegarla manualmente.
        const localConflict = await tx.season.findFirst({
          where: { code: navCode, navSeasonId: null },
          select: { id: true },
        });
        if (localConflict) {
          logger.warn({ entity, navCode }, 'NAV sync: season locale con stesso code senza NAV link — skip auto-create');
          return;
        }

        // Upsert season locale: crea se non esiste, aggiorna solo name.
        // MAI toccare isActive né altri campi arricchiti.
        await tx.season.upsert({
          where: { navSeasonId: navCode },
          create: { code: navCode, name: description, navSeasonId: navCode, isActive: true },
          update: { name: description },
        });
      });
    } catch (err) {
      errors++;
      logger.error({ entity, navCode, err }, 'NAV sync: errore upsert season');
    }
  });

  logger.info({ entity, filterMode, upserted: rows.length, errors }, 'NAV sync: completato');
  return { entity, upserted: rows.length - errors, skipped: false, filterMode };
}
