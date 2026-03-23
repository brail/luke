import type { PrismaClient } from '@prisma/client';
import pino from 'pino';

import { getNavDbConfig, type GetConfigFn } from '../config.js';
import { getPool } from '../client.js';
import { syncVendors, type SyncResult } from './vendors.js';

export interface NavSyncReport {
  startedAt: Date;
  completedAt: Date;
  results: SyncResult[];
}

/**
 * Orchestratore del sync NAV.
 *
 * Accetta un PrismaClient e la funzione getConfig di configManager
 * (dependency injection — il package non dipende da apps/api).
 *
 * Il flag readOnly blocca il sync: se attivo significa che la connessione
 * non è ancora verificata per operazioni sicure.
 */
export async function runNavSync(
  prisma: PrismaClient,
  getConfig: GetConfigFn,
  logger = pino({ level: 'info' }),
): Promise<NavSyncReport> {
  const startedAt = new Date();
  logger.info('NAV sync: avvio');

  const config = await getNavDbConfig(prisma, getConfig);

  if (!config.syncEnabled) {
    logger.info(
      { syncEnabled: false },
      'NAV sync: sincronizzazione disabilitata (syncEnabled=false) — abilitare in Impostazioni > Microsoft NAV',
    );
    return { startedAt, completedAt: new Date(), results: [] };
  }

  const pool = await getPool(config);
  const results: SyncResult[] = [];

  results.push(await syncVendors(pool, prisma, config, logger));

  const completedAt = new Date();
  const totalUpserted = results.reduce((sum, r) => sum + r.upserted, 0);

  logger.info(
    { totalUpserted, durationMs: completedAt.getTime() - startedAt.getTime() },
    'NAV sync: tutti i task completati',
  );

  return { startedAt, completedAt, results };
}
