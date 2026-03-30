/**
 * Scheduler per la sincronizzazione periodica NAV → PG del portafoglio ordini.
 *
 * Avvio: hook onReady di Fastify (dopo che il server è in ascolto).
 * Arresto: hook onClose di Fastify (ferma il timer).
 *
 * Design:
 * - Tick ogni 1 minuto.
 * - Legge la configurazione (autoSyncEnabled, intervalMinutes) da NavSyncFilter
 *   dove entity='portafoglio' a ogni tick — nessun restart necessario per applicare modifiche.
 * - Se non esiste configurazione il sync automatico è disabilitato.
 * - `triggerPortafoglioSyncNow()` è esportato per il tRPC handler "Aggiorna Ora".
 * - Un errore di sync non causa il crash del server.
 */

import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';

import { getNavDbConfig, getPool } from '@luke/nav';

import { syncPortafoglioNow, type PortafoglioSyncResult } from '../services/nav-portafoglio-sync';
import { getConfig } from './configManager';

export type { PortafoglioSyncResult };

// ─── Module-level state ───────────────────────────────────────────────────────

const TICK_INTERVAL_MS = 60 * 1000; // controlla ogni minuto

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

  try {
    const navConfig = await getNavDbConfig(_prisma, getConfig);
    const pool = await getPool(navConfig);
    return await syncPortafoglioNow(pool, navConfig.company, _prisma, log);
  } catch (err) {
    log.error({ err }, 'Portafoglio sync scheduler: sync fallito');
    return null;
  } finally {
    _isRunning = false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Avvia un sync del portafoglio immediatamente.
 * Restituisce null se un sync è già in corso o NAV non è configurato.
 * Usato dal tRPC handler "Aggiorna Ora".
 */
export async function triggerPortafoglioSyncNow(): Promise<PortafoglioSyncResult | null> {
  return _runSync();
}

/** Restituisce true se un sync è attualmente in corso. */
export function isPortafoglioSyncRunning(): boolean {
  return _isRunning;
}

// ─── Fastify registration ────────────────────────────────────────────────────

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
