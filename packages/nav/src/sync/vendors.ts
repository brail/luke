import type { PrismaClient, Prisma } from '@prisma/client';
import type { Logger } from 'pino';
import type mssql from 'mssql';

import { sanitizeCompany } from '../config.js';
import type { NavDbConfig } from '../config.js';
import { buildNavSyncFilter, buildWhereClause, processInBatches } from './utils.js';

export interface SyncResult {
  entity: string;
  upserted: number;
  skipped: boolean;
  filterMode: string;
}

/** Quanti upsert Prisma eseguire in parallelo per batch. */
const UPSERT_BATCH_SIZE = 100;

/**
 * Sincronizza [COMPANY$Vendor] di NAV → tabella nav_vendors di Postgres.
 *
 * Sync differenziale:
 * - Se nav_vendors è vuota → full sync (no clausola temporale)
 * - Altrimenti → record con [Last Date Modified] > MAX(navLastModified) locale
 *   oppure [Last Date Modified] IS NULL (vendor senza data aggiornamento).
 *   Il secondo predicato è necessario perché SQL Server esclude i NULL dai
 *   confronti > , e quei record non verrebbero mai rilevati dopo il primo sync.
 */
export async function syncVendors(
  pool: mssql.ConnectionPool,
  prisma: PrismaClient,
  config: NavDbConfig,
  logger: Logger,
): Promise<SyncResult> {
  const entity = 'vendor';

  const filter = await prisma.navSyncFilter.findUnique({ where: { entity } });
  const filterResult = buildNavSyncFilter(filter, logger, entity, 'No_');

  if (filterResult.shouldSkip) {
    return { entity, upserted: 0, skipped: true, filterMode: filterResult.filterMode };
  }

  const { filterMode, filterPredicates, bindParams } = filterResult;

  // Watermark per sync differenziale — usata solo in mode=all/exclude.
  // In modalità whitelist si fa sempre full sync dei vendor selezionati:
  // la lista è piccola e un vendor precedentemente sincronizzato (watermark > 0)
  // verrebbe altrimenti escluso anche se fa parte della nuova selezione.
  const useWatermark = filter?.mode !== 'whitelist';
  let lastModified: Date | null = null;
  if (useWatermark) {
    const agg = await prisma.navVendor.aggregate({ _max: { navLastModified: true } });
    lastModified = agg._max.navLastModified;
  }

  // Combina watermark + predicati filtro entità
  const whereParts: string[] = [];
  if (lastModified) {
    // SQL Server esclude i NULL dai confronti >, quindi l'OR IS NULL è necessario
    // per non perdere vendor senza data di modifica dopo il primo sync.
    whereParts.push('([Last Date Modified] > @lastModified OR [Last Date Modified] IS NULL)');
  }
  whereParts.push(...filterPredicates);

  const whereClause = buildWhereClause(whereParts);

  const tableName = `[${sanitizeCompany(config.company)}$Vendor]`;
  const request = pool.request();
  // mssql type definitions don't expose `timeout` but it's a valid runtime property
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (request as any).timeout = 60_000;

  if (lastModified) request.input('lastModified', lastModified);
  bindParams(request);

  const result = await request.query<{
    'No_': string;
    'Name': string;
    'Name 2': string | null;
    'Search Name': string | null;
    'First Name': string | null;
    'Last Name': string | null;
    'Address': string | null;
    'Address 2': string | null;
    'Post Code': string | null;
    'City': string | null;
    'County': string | null;
    'Country_Region Code': string | null;
    'Phone No_': string | null;
    'Fax No_': string | null;
    'E-Mail': string | null;
    'Home Page': string | null;
    'Contact': string | null;
    'Vendor Type': string | null;
    'Last Date Modified': Date | null;
  }>(`
    SELECT
      [No_], [Name], [Name 2], [Search Name],
      [First Name], [Last Name],
      [Address], [Address 2], [Post Code], [City], [County], [Country_Region Code],
      [Phone No_], [Fax No_], [E-Mail], [Home Page], [Contact],
      [Vendor Type], [Last Date Modified]
    FROM ${tableName}
    ${whereClause}
  `);

  const rows = result.recordset;

  if (rows.length === 0) {
    logger.info({ entity, filterMode, upserted: 0 }, 'NAV sync: nessun record da aggiornare');
    return { entity, upserted: 0, skipped: false, filterMode };
  }

  const syncedAt = new Date();

  let errors = 0;
  await processInBatches(rows, UPSERT_BATCH_SIZE, async row => {
    const navNo = row['No_'];
    const name = row['Name'] ?? '';

    try {
      const data = {
        name,
        name2: row['Name 2'] ?? null,
        searchName: row['Search Name'] ?? null,
        firstName: row['First Name'] ?? null,
        lastName: row['Last Name'] ?? null,
        address: row['Address'] ?? null,
        address2: row['Address 2'] ?? null,
        postCode: row['Post Code'] ?? null,
        city: row['City'] ?? null,
        county: row['County'] ?? null,
        countryCode: row['Country_Region Code'] ?? null,
        phoneNo: row['Phone No_'] ?? null,
        faxNo: row['Fax No_'] ?? null,
        email: row['E-Mail'] ?? null,
        homePage: row['Home Page'] ?? null,
        contact: row['Contact'] ?? null,
        vendorType: row['Vendor Type'] ?? null,
        navLastModified: row['Last Date Modified'] ?? null,
        syncedAt,
      };

      const countryCode = row['Country_Region Code'] ?? null;

      // Atomico: replica NAV + anagrafica locale in un'unica transaction.
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.navVendor.upsert({
          where: { navNo },
          create: { navNo, ...data },
          update: data,
        });

        // Upsert anagrafica interna Vendor: crea se non esiste, aggiorna name e countryCode.
        // Non toccare isActive né campi arricchiti — un vendor soft-deleted
        // non viene riattivato dal sync.
        await tx.vendor.upsert({
          where: { navVendorId: navNo },
          create: { name, countryCode, navVendorId: navNo, isActive: true },
          update: { name, countryCode },
        });
      });
    } catch (err) {
      errors++;
      logger.error({ entity, navNo, err }, 'NAV sync: errore upsert vendor');
    }
  });

  logger.info({ entity, filterMode, upserted: rows.length, errors }, 'NAV sync: completato');
  return { entity, upserted: rows.length - errors, skipped: false, filterMode };
}
