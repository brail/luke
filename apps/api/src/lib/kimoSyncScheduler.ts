/**
 * Periodic scheduler for NAV → Postgres synchronisation of KIMO-FASHION tables.
 *
 * Design mirrors `portafoglioSyncScheduler`:
 * - Global tick every 1 minute.
 * - Reads `autoSyncEnabled` and `intervalMinutes` from NavSyncFilter (entity = 'kimo') on every tick.
 * - `triggerKimoSyncNow()` is exposed for manual triggers from the tRPC handler.
 * - Sync errors are logged but do not crash the server.
 */


import { getNavDbConfig, getPool, syncKimoNow, type KimoSyncResult } from '@luke/nav';

import { getConfig } from './configManager';
import { notifyAdmins, notifyDeduped, SYSTEM_SUCCESS_DEDUP_MS, SYSTEM_FAILURE_DEDUP_MS } from './notifications';
import { sseStore } from './sseStore';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

export type { KimoSyncResult };

// ─── Module-level state ───────────────────────────────────────────────────────

const TICK_INTERVAL_MS = 60 * 1000;

let _isRunning = false;
let _lastRunAt: Date | null = null;
let _prisma: PrismaClient | null = null;
let _logger: Logger | null = null;

// ─── Internal runner ──────────────────────────────────────────────────────────

async function _runSync(): Promise<KimoSyncResult | null> {
  if (_isRunning || !_prisma || !_logger) return null;

  _isRunning = true;
  _lastRunAt = new Date();
  const log = _logger;
  const prisma = _prisma;
  sseStore.pushToAll({ type: 'sync-state', entity: 'kimo', isRunning: true });

  try {
    const navConfig = await getNavDbConfig(prisma, getConfig);
    const pool = await getPool(navConfig);
    const result = await syncKimoNow(pool, navConfig.company, prisma, log);
    await notifyDeduped('kimo-sync:success', SYSTEM_SUCCESS_DEDUP_MS, () => notifyAdmins(prisma, {
      category: 'SYSTEM',
      title: 'KIMO sync completato',
      message: `${result.totalDurationMs}ms`,
      data: { type: 'kimo_sync_success' },
    })).catch(e => log.error({ err: e }, 'Failed to notify admins of sync success'));
    return result;
  } catch (err) {
    log.error({ err }, 'Kimo sync scheduler: sync fallito');
    await notifyDeduped('kimo-sync:failure', SYSTEM_FAILURE_DEDUP_MS, () => notifyAdmins(prisma, {
      category: 'SYSTEM',
      title: 'KIMO sync fallito',
      message: (err as Error).message ?? 'Errore sconosciuto',
      data: { type: 'kimo_sync_failure' },
    })).catch(e => log.error({ err: e }, 'Failed to notify admins of sync failure'));
    return null;
  } finally {
    _isRunning = false;
    sseStore.pushToAll({ type: 'sync-state', entity: 'kimo', isRunning: false });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Triggers an immediate KIMO sync run.
 *
 * @returns Sync result, or `null` if a sync is already in progress or NAV is not configured.
 */
export async function triggerKimoSyncNow(): Promise<KimoSyncResult | null> {
  return _runSync();
}

/** Returns `true` if a KIMO sync is currently in progress. */
export function isKimoSyncRunning(): boolean {
  return _isRunning;
}

// ─── Fastify registration ─────────────────────────────────────────────────────

/**
 * Registers the KIMO sync scheduler as a Fastify plugin.
 * Starts the tick interval on `onReady` and clears it on `onClose`.
 */
export function registerKimoSyncScheduler(
  fastify: FastifyInstance,
  prisma: PrismaClient,
): void {
  _prisma = prisma;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (_isRunning) return;

    const host = await getConfig(prisma, 'integrations.nav.host', false);
    if (!host) return;

    const config = await prisma.navSyncFilter.findUnique({
      where: { entity: 'kimo' },
      select: { autoSyncEnabled: true, intervalMinutes: true },
    });

    if (!config?.autoSyncEnabled) return;

    const intervalMs = (config.intervalMinutes ?? 30) * 60 * 1000;
    const elapsed = _lastRunAt ? Date.now() - _lastRunAt.getTime() : Infinity;
    if (elapsed < intervalMs) return;

    void _runSync();
  };

  fastify.addHook('onReady', async () => {
    _logger = fastify.log as unknown as Logger;
    fastify.log.info('Kimo sync scheduler: avviato (tick ogni minuto, intervallo configurabile)');

    void tick();

    timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
  });

  fastify.addHook('onClose', async () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    fastify.log.info('Kimo sync scheduler: fermato');
  });
}
