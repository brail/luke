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

import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

import { getNavDbConfig, getPool } from '@luke/nav';

import { syncPortafoglioNow, type PortafoglioSyncResult } from '../services/nav-portafoglio-sync';
import { getConfig } from './configManager';
import { notifyAdmins } from './notifications';
import { sseStore } from './sseStore';

export type { PortafoglioSyncResult };

// ─── Module-level state ───────────────────────────────────────────────────────

const TICK_INTERVAL_MS = 60 * 1000; // controlla ogni minuto

let _isRunning = false;
let _lastRunAt: Date | null = null;
let _prisma: PrismaClient | null = null;
let _logger: Logger | null = null;
let _lastSuccessNotified = 0;
const SUCCESS_DEDUP_MS = 24 * 60 * 60 * 1000;

// ─── Internal runner ──────────────────────────────────────────────────────────

async function _runSync(): Promise<PortafoglioSyncResult | null> {
  if (_isRunning || !_prisma || !_logger) return null;

  _isRunning = true;
  _lastRunAt = new Date();
  const log = _logger;
  sseStore.pushToAll({ type: 'sync-state', entity: 'portafoglio', isRunning: true });

  try {
    const navConfig = await getNavDbConfig(_prisma, getConfig);
    const pool = await getPool(navConfig);
    const result = await syncPortafoglioNow(pool, navConfig.company, _prisma, log);
    if (Date.now() - _lastSuccessNotified > SUCCESS_DEDUP_MS) {
      await notifyAdmins(_prisma, {
        category: 'SYSTEM',
        title: 'Portafoglio sync completato',
        message: `${result.totalDurationMs}ms`,
        data: { type: 'portafoglio_sync_success' },
      });
      _lastSuccessNotified = Date.now();
    }
    return result;
  } catch (err) {
    log.error({ err }, 'Portafoglio sync scheduler: sync fallito');
    await notifyAdmins(_prisma, {
      category: 'SYSTEM',
      title: 'Portafoglio sync fallito',
      message: (err as Error).message ?? 'Errore sconosciuto',
      data: { type: 'portafoglio_sync_failure' },
    }).catch(e => log.error({ err: e }, 'Failed to notify admins of sync failure'));
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

    // Controlla che NAV sia configurato prima di tentare la connessione
    const host = await getConfig(prisma, 'integrations.nav.host', false);
    if (!host) return;

    // Legge la configurazione di pianificazione dal DB a ogni tick
    const config = await prisma.navSyncFilter.findUnique({
      where: { entity: 'portafoglio' },
      select: { autoSyncEnabled: true, intervalMinutes: true },
    });

    if (!config?.autoSyncEnabled) return;

    const intervalMs = (config.intervalMinutes ?? 5) * 60 * 1000;
    const elapsed = _lastRunAt ? Date.now() - _lastRunAt.getTime() : Infinity;
    if (elapsed < intervalMs) return;

    void _runSync();
  };

  fastify.addHook('onReady', async () => {
    _logger = fastify.log as unknown as Logger;
    fastify.log.info('Portafoglio sync scheduler: avviato (tick ogni minuto, intervallo configurabile)');

    // Prima esecuzione subito dopo il ready (rispettando la config DB)
    void tick();

    timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
  });

  fastify.addHook('onClose', async () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    fastify.log.info('Portafoglio sync scheduler: fermato');
  });
}
