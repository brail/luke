import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type mssql from 'mssql';

import type { NavDbConfig } from '../config.js';

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
 *
 * NavSyncFilter:
 * - active=false → skip completo
 * - mode "all"       → solo filtro differenziale
 * - mode "whitelist" → AND [No_] IN (navNos)
 * - mode "exclude"   → AND [No_] NOT IN (navNos)
 */
export async function syncVendors(
  pool: mssql.ConnectionPool,
  prisma: PrismaClient,
  config: NavDbConfig,
  logger: Logger,
): Promise<SyncResult> {
  const entity = 'vendor';

  // 1. Leggi NavSyncFilter per "vendor"
  const filter = await prisma.navSyncFilter.findUnique({ where: { entity } });

  // 2. Se active = false → skip
  if (filter && !filter.active) {
    logger.info({ entity, filter: 'disabled' }, 'NAV sync: entità disabilitata, skip');
    return { entity, upserted: 0, skipped: true, filterMode: 'disabled' };
  }

  const filterMode = filter?.mode ?? 'all';

  // 3. Calcola soglia per sync differenziale
  const agg = await prisma.navVendor.aggregate({ _max: { navLastModified: true } });
  const lastModified = agg._max.navLastModified;

  // 4. Costruisci WHERE clause
  const tableName = `[${config.company}$Vendor]`;
  const whereParts: string[] = [];

  if (lastModified) {
    // Includi record modificati dopo il watermark OPPURE senza data di modifica:
    // SQL Server esclude i NULL dai confronti >, quindi senza l'OR IS NULL i vendor
    // creati senza data di modifica sparirebbero dopo il primo full sync.
    whereParts.push(
      '([Last Date Modified] > @lastModified OR [Last Date Modified] IS NULL)',
    );
  }

  if (filterMode === 'whitelist' && filter!.navNos.length > 0) {
    const placeholders = filter!.navNos.map((_, i) => `@wl${i}`).join(', ');
    whereParts.push(`[No_] IN (${placeholders})`);
  } else if (filterMode === 'exclude' && filter!.navNos.length > 0) {
    const placeholders = filter!.navNos.map((_, i) => `@ex${i}`).join(', ');
    whereParts.push(`[No_] NOT IN (${placeholders})`);
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

  // 5. Esegui query su SQL Server
  const request = pool.request();

  if (lastModified) {
    request.input('lastModified', lastModified);
  }

  if (filterMode === 'whitelist' && filter!.navNos.length > 0) {
    filter!.navNos.forEach((no, i) => request.input(`wl${i}`, no));
  } else if (filterMode === 'exclude' && filter!.navNos.length > 0) {
    filter!.navNos.forEach((no, i) => request.input(`ex${i}`, no));
  }

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

  // 6. Upsert su Postgres in batch per evitare di saturare il connection pool
  const syncedAt = new Date();

  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);

    await Promise.all(
      batch.map(row => {
        const data = {
          name: row['Name'] ?? '',
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

        return prisma.navVendor.upsert({
          where: { navNo: row['No_'] },
          create: { navNo: row['No_'], ...data },
          update: data,
        });
      }),
    );
  }

  logger.info({ entity, filterMode, upserted: rows.length }, 'NAV sync: completato');
  return { entity, upserted: rows.length, skipped: false, filterMode };
}
