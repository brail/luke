import type { PrismaClient } from '@prisma/client';
import pino from 'pino';

import { getNavDbConfig, type GetConfigFn } from '../config.js';
import { getPool } from '../client.js';
import { syncVendors, type SyncResult } from './vendors.js';
import { syncBrands } from './brands.js';
import { syncSeasons } from './seasons.js';

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
 * @param entity - Se specificata, sincronizza solo quell'entità.
 *                 Se omessa, sincronizza tutte e tre (vendor, brand, season).
 */
export async function runNavSync(
  prisma: PrismaClient,
  getConfig: GetConfigFn,
  logger = pino({ level: 'info' }),
  entity?: 'vendor' | 'brand' | 'season',
): Promise<NavSyncReport> {
  const startedAt = new Date();
  logger.info({ entity: entity ?? 'all' }, 'NAV sync: avvio');

  const config = await getNavDbConfig(prisma, getConfig);
  const pool = await getPool(config);
  const results: SyncResult[] = [];

  if (!entity || entity === 'vendor') {
    results.push(await syncVendors(pool, prisma, config, logger));
  }
  if (!entity || entity === 'brand') {
    results.push(await syncBrands(pool, prisma, config, logger));
  }
  if (!entity || entity === 'season') {
    results.push(await syncSeasons(pool, prisma, config, logger));
  }

  const completedAt = new Date();
  const totalUpserted = results.reduce((sum, r) => sum + r.upserted, 0);
  const totalSkipped = results.filter(r => r.skipped).length;

  logger.info(
    { entity: entity ?? 'all', totalUpserted, totalSkipped, durationMs: completedAt.getTime() - startedAt.getTime() },
    'NAV sync: completato',
  );

  return { startedAt, completedAt, results };
}
