/**
 * Scheduler per la sincronizzazione periodica NAV → PG delle tabelle KIMO-FASHION.
 *
 * Design identico a portafoglioSyncScheduler:
 * - Tick ogni 1 minuto.
 * - Legge configurazione (autoSyncEnabled, intervalMinutes) da NavSyncFilter entity='kimo'.
 * - `triggerKimoSyncNow()` per trigger manuale dal tRPC handler.
 * - Errori di sync non causano crash del server.
 */

import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

import { getNavDbConfig, getPool } from '@luke/nav';

import { syncKimoNow, type KimoSyncResult } from '../services/nav-kimo-sync';
import { getConfig } from './configManager';
import { notifyAdmins } from './notifications';
import { sseStore } from './sseStore';

export type { KimoSyncResult };

// ─── Module-level state ───────────────────────────────────────────────────────

const TICK_INTERVAL_MS = 60 * 1000;

let _isRunning = false;
let _lastRunAt: Date | null = null;
let _prisma: PrismaClient | null = null;
let _logger: Logger | null = null;
let _lastSuccessNotified = 0;
const SUCCESS_DEDUP_MS = 24 * 60 * 60 * 1000;

// ─── Internal runner ──────────────────────────────────────────────────────────

async function _runSync(): Promise<KimoSyncResult | null> {
  if (_isRunning || !_prisma || !_logger) return null;

  _isRunning = true;
  _lastRunAt = new Date();
  const log = _logger;
  sseStore.pushToAll({ type: 'sync-state', entity: 'kimo', isRunning: true });

  try {
    const navConfig = await getNavDbConfig(_prisma, getConfig);
    const pool = await getPool(navConfig);
    const result = await syncKimoNow(pool, navConfig.company, _prisma, log);
    if (Date.now() - _lastSuccessNotified > SUCCESS_DEDUP_MS) {
      await notifyAdmins(_prisma, {
        category: 'SYSTEM',
        title: 'KIMO sync completato',
        message: `${result.totalDurationMs}ms`,
        data: { type: 'kimo_sync_success' },
      });
      _lastSuccessNotified = Date.now();
    }
    return result;
  } catch (err) {
    log.error({ err }, 'Kimo sync scheduler: sync fallito');
    await notifyAdmins(_prisma, {
      category: 'SYSTEM',
      title: 'KIMO sync fallito',
      message: (err as Error).message ?? 'Errore sconosciuto',
      data: { type: 'kimo_sync_failure' },
    }).catch(e => log.error({ err: e }, 'Failed to notify admins of sync failure'));
    return null;
  } finally {
    _isRunning = false;
    sseStore.pushToAll({ type: 'sync-state', entity: 'kimo', isRunning: false });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Avvia un sync KIMO immediatamente.
 * Restituisce null se già in corso o NAV non configurato.
 */
export async function triggerKimoSyncNow(): Promise<KimoSyncResult | null> {
  return _runSync();
}

/** Restituisce true se un sync KIMO è attualmente in corso. */
export function isKimoSyncRunning(): boolean {
  return _isRunning;
}

// ─── Fastify registration ─────────────────────────────────────────────────────

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
