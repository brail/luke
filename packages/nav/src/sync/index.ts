import pino from 'pino';

import { getPool } from '../client.js';
import { getNavDbConfig, type GetConfigFn } from '../config.js';

import { syncBrands } from './brands.js';
import { syncSeasons } from './seasons.js';
import { syncVendors, type SyncResult } from './vendors.js';

import type { PrismaClient } from '@prisma/client';

/**
 * Summary returned by `runNavSync` after one full or partial sync run.
 */
export interface NavSyncReport {
  startedAt: Date;
  completedAt: Date;
  results: SyncResult[];
}

/**
 * Orchestrates the NAV sync for one or all entities.
 *
 * Accepts a `PrismaClient` and the `getConfig` function from `configManager`
 * via dependency injection so this package does not depend on `apps/api`.
 *
 * Each entity sync runs in its own try/catch: a failure in one entity does
 * not abort the others.
 *
 * @param prisma - Prisma client used to read AppConfig and write local tables
 * @param getConfig - Config accessor injected from `apps/api/src/lib/configManager`
 * @param logger - Pino logger instance (defaults to `info` level)
 * @param entity - When provided, syncs only that entity; omit to sync all three
 * @returns Report with per-entity upsert counts and overall timing
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

  const syncEntity = async (
    name: string,
    fn: () => Promise<SyncResult>,
  ): Promise<SyncResult> => {
    try {
      return await fn();
    } catch (err) {
      logger.error({ entity: name, err }, 'NAV sync: errore critico sync entità');
      return { entity: name, upserted: 0, skipped: false, filterMode: 'error' };
    }
  };

  if (!entity || entity === 'vendor') {
    results.push(await syncEntity('vendor', () => syncVendors(pool, prisma, config, logger)));
  }
  if (!entity || entity === 'brand') {
    results.push(await syncEntity('brand', () => syncBrands(pool, prisma, config, logger)));
  }
  if (!entity || entity === 'season') {
    results.push(await syncEntity('season', () => syncSeasons(pool, prisma, config, logger)));
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
