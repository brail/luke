/**
 * Periodic scheduler for NAV → Postgres synchronisation of the order portafoglio.
 *
 * Startup: Fastify `onReady` hook (after the server begins listening).
 * Shutdown: Fastify `onClose` hook (stops the timer).
 *
 * Design:
 * - Global tick every 1 minute.
 * - Reads `autoSyncEnabled` and `intervalMinutes` from NavSyncFilter (entity = 'portafoglio')
 *   on every tick — changes take effect within one minute without a restart.
 * - Automatic sync is disabled when no configuration row exists.
 * - `triggerPortafoglioSyncNow()` is exported for the "Sync Now" tRPC handler.
 * - Sync errors are logged but do not crash the server.
 */


import { getNavDbConfig, getPool, syncPortafoglioNow, type PortafoglioSyncResult } from '@luke/nav';

import { getConfig } from './configManager';
import { guardMaintenance } from './maintenanceMode';
import { notifyAdmins, notifyDeduped, SYSTEM_FAILURE_DEDUP_MS } from './notifications';
import { withSchedulerLock } from './schedulerLock';
import { sseStore } from './sseStore';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';

export type { PortafoglioSyncResult };

// ─── Module-level state ───────────────────────────────────────────────────────

const TICK_INTERVAL_MS = 60 * 1000; // checks every minute

let _isRunning = false;
let _lastRunAt: Date | null = null;
let _prisma: PrismaClient | null = null;
let _logger: Logger | null = null;

// ─── Internal runner ──────────────────────────────────────────────────────────

async function _runSync(): Promise<PortafoglioSyncResult | null> {
  if (_isRunning || !_prisma || !_logger) return null;

  _isRunning = true;
  _lastRunAt = new Date();
  const log = _logger;
  const prisma = _prisma;
  sseStore.pushToAll({ type: 'sync-state', entity: 'portafoglio', isRunning: true });

  try {
    const navConfig = await getNavDbConfig(prisma, getConfig);
    const pool = await getPool(navConfig);
    const result = await syncPortafoglioNow(pool, navConfig.company, prisma, log);
    return result;
  } catch (err) {
    log.error({ err }, 'Portafoglio sync scheduler: sync fallito');
    await notifyDeduped(prisma, 'portafoglio-sync:failure', SYSTEM_FAILURE_DEDUP_MS, () => notifyAdmins(prisma, {
      category: 'SYSTEM',
      title: 'Portafoglio sync fallito',
      message: (err as Error).message ?? 'Errore sconosciuto',
      data: { type: 'portafoglio_sync_failure' },
    })).catch(e => log.error({ err: e }, 'Failed to notify admins of sync failure'));
    return null;
  } finally {
    _isRunning = false;
    sseStore.pushToAll({ type: 'sync-state', entity: 'portafoglio', isRunning: false });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Triggers an immediate portafoglio sync run.
 *
 * @returns Sync result, or `null` if a sync is already in progress or NAV is not configured.
 */
export async function triggerPortafoglioSyncNow(): Promise<PortafoglioSyncResult | null> {
  return _runSync();
}

/** Returns `true` if a portafoglio sync is currently in progress. */
export function isPortafoglioSyncRunning(): boolean {
  return _isRunning;
}

// ─── Fastify registration ────────────────────────────────────────────────────

/**
 * Registers the portafoglio sync scheduler as a Fastify plugin.
 * Starts the tick interval on `onReady` and clears it on `onClose`.
 */
export function registerPortafoglioSyncScheduler(
  fastify: FastifyInstance,
  prisma: PrismaClient,
): void {
  _prisma = prisma;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (_isRunning) return;

    // Verifies NAV is configured before attempting connection
    const host = await getConfig(prisma, 'integrations.nav.host', false);
    if (!host) return;

    // Reads scheduling configuration from DB on every tick
    const config = await prisma.navSyncFilter.findUnique({
      where: { entity: 'portafoglio' },
      select: { autoSyncEnabled: true, intervalMinutes: true },
    });

    if (!config?.autoSyncEnabled) return;

    const intervalMs = (config.intervalMinutes ?? 5) * 60 * 1000;
    const elapsed = _lastRunAt ? Date.now() - _lastRunAt.getTime() : Infinity;
    if (elapsed < intervalMs) return;

    // Locked around _runSync (not the outer tick): _runSync is fire-and-forget from here, so
    // the tick itself returns almost instantly — the lock must span the actual sync work.
    void withSchedulerLock(prisma, 'portafoglio-sync', _runSync)();
  };

  const guardedTick = guardMaintenance(prisma, tick);

  fastify.addHook('onReady', async () => {
    _logger = fastify.log as unknown as Logger;
    fastify.log.info('Portafoglio sync scheduler: avviato (tick ogni minuto, intervallo configurabile)');

    // First execution immediately after ready (respecting DB config)
    void guardedTick();

    timer = setInterval(() => void guardedTick(), TICK_INTERVAL_MS);
  });

  fastify.addHook('onClose', async () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    fastify.log.info('Portafoglio sync scheduler: fermato');
  });
}
