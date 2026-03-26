import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type mssql from 'mssql';

import { sanitizeCompany } from '../config.js';
import type { NavDbConfig } from '../config.js';
import type { SyncResult } from './vendors.js';
import { buildNavSyncFilter, buildWhereClause, processInBatches } from './utils.js';

const UPSERT_BATCH_SIZE = 100;

/**
 * Sincronizza [COMPANY$Brand] di NAV → tabella nav_brands di Postgres.
 *
 * Sync completo (no watermark differenziale): [COMPANY$Brand] espone solo il
 * campo timestamp SQL Server (rowversion binario), non una data di modifica.
 * La tabella è tipicamente piccola (<200 record) quindi il full sync è preferibile.
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
  const request = pool.request();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (request as any).timeout = 60_000;
  bindParams(request);

  const result = await request.query<{
    'Code': string;
    'Description': string | null;
  }>(`SELECT [Code], [Description] FROM ${tableName} ${whereClause}`);

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

    try {
      // Atomico: replica NAV + anagrafica locale in un'unica transaction.
      await prisma.$transaction(async (tx) => {
        await tx.navBrand.upsert({
          where: { navCode },
          create: { navCode, description, syncedAt },
          update: { description, syncedAt },
        });

        // Guard: se esiste già un brand locale con lo stesso code ma senza collegamento NAV,
        // non auto-creare — l'utente deve collegarlo manualmente.
        const localConflict = await tx.brand.findFirst({
          where: { code: navCode, navBrandId: null },
          select: { id: true },
        });
        if (localConflict) {
          logger.warn({ entity, navCode }, 'NAV sync: brand locale con stesso code senza NAV link — skip auto-create');
          return;
        }

        // Upsert brand locale: crea se non esiste, aggiorna solo name.
        // MAI toccare isActive né logoUrl né altri campi arricchiti.
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
