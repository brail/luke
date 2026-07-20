/**
 * Scheduler per la sincronizzazione periodica NAV → DB locale.
 *
 * Avvio: hook onReady di Fastify (dopo che il server è in ascolto).
 * Arresto: hook onClose di Fastify (ferma il timer e chiude il pool mssql).
 *
 * Design:
 * - Tick globale ogni minuto.
 * - Ad ogni tick, per ogni entità (vendor, brand, season): se autoSyncEnabled=true
 *   e sono trascorsi almeno intervalMinutes dall'ultima esecuzione, avvia il sync.
 * - Il filtro viene riletto dal DB ad ogni tick: le modifiche all'intervallo o
 *   all'abilitazione sono operative al tick successivo (entro 1 minuto), senza restart.
 *
 * Un errore di sync non causa il crash del server: viene loggato e il ciclo
 * successivo parte normalmente.
 */


import { closePool, runNavSync } from '@luke/nav';

import { getConfig } from './configManager';
import { notifyAdmins } from './notifications';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

const TICK_INTERVAL_MS = 60 * 1000; // 1 minuto
const NAV_SUCCESS_DEDUP_MS = 24 * 60 * 60 * 1000;
const lastNavSuccessNotified = new Map<string, number>();

const ENTITIES = ['vendor', 'brand', 'season'] as const;
type Entity = (typeof ENTITIES)[number];

// Timestamp (ms) dell'ultima esecuzione completata per entità
const lastRunAt: Partial<Record<Entity, number>> = {};

// Flag per entità: evita sync concorrenti
const isRunning: Partial<Record<Entity, boolean>> = {};

/**
 * Attende che il sync in corso finisca (se attivo) e blocca le nuove esecuzioni.
 * Usato da saveConfig prima di closePool() per evitare pool null a metà operazione.
 * Chiamare resumeNavScheduler() dopo per riaprire il semaforo.
 */
let _pauseResolve: (() => void) | null = null;
let _isPaused = false;

/**
 * Pauses the NAV scheduler and waits for any in-progress sync runs to finish.
 * Use this before closing the mssql pool (e.g. when reconfiguring the NAV connection)
 * to avoid null-pool errors mid-operation. Call `resumeNavScheduler()` afterwards.
 */
export async function pauseNavScheduler(): Promise<void> {
  _isPaused = true;
  // Aspetta che tutte le entità in corso finiscano
  const running = ENTITIES.filter(e => isRunning[e]);
  if (running.length === 0) return;
  return new Promise(resolve => {
    _pauseResolve = resolve;
    // Il resolve viene chiamato in _checkAllDone() quando tutte le entità completano
  });
}

/**
 * Resumes the NAV scheduler after a call to `pauseNavScheduler()`.
 */
export function resumeNavScheduler(): void {
  _isPaused = false;
  _pauseResolve = null;
}

function _checkAllDone(): void {
  if (_pauseResolve && ENTITIES.every(e => !isRunning[e])) {
    _pauseResolve();
    _pauseResolve = null;
  }
}

/**
 * Registers the NAV sync scheduler as a Fastify plugin.
 * Starts a global 60-second tick on `onReady`; each tick re-reads per-entity
 * `NavSyncFilter` settings from the database so interval/enable changes take
 * effect within one minute without a restart. Closes the mssql pool on `onClose`.
 */
export function registerNavSyncScheduler(
  fastify: FastifyInstance,
  prisma: PrismaClient,
): void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const syncEntity = async (entity: Entity) => {
    if (isRunning[entity] || _isPaused) return;

    isRunning[entity] = true;
    fastify.log.info({ entity }, 'NAV sync scheduler: avvio sync entità');

    try {
      const report = await runNavSync(prisma, getConfig, undefined, entity);
      const durationMs = report.completedAt.getTime() - report.startedAt.getTime();

      for (const r of report.results) {
        if (r.skipped) {
          fastify.log.info({ entity: r.entity }, 'NAV sync scheduler: entità saltata (filtro disabilitato)');
        } else {
          fastify.log.info({ entity: r.entity, upserted: r.upserted, durationMs }, 'NAV sync scheduler: entità completata');
        }
      }
      const lastNotified = lastNavSuccessNotified.get(entity) ?? 0;
      if (Date.now() - lastNotified > NAV_SUCCESS_DEDUP_MS) {
        const totalUpserted = report.results.reduce((s, r) => s + (r.upserted ?? 0), 0);
        try {
          await notifyAdmins(prisma, {
            category: 'SYSTEM',
            title: `NAV sync ${entity} completato`,
            message: `${totalUpserted} record in ${durationMs}ms`,
            data: { entity, type: 'nav_sync_success' },
          });
          lastNavSuccessNotified.set(entity, Date.now());
        } catch (e) {
          fastify.log.error({ err: e }, 'Failed to notify admins of sync success');
        }
      }
    } catch (err) {
      fastify.log.error({ err, entity }, 'NAV sync scheduler: sync fallito');
      await notifyAdmins(prisma, {
        category: 'SYSTEM',
        title: `NAV sync ${entity} fallito`,
        message: (err as Error).message ?? 'Errore sconosciuto',
        data: { entity, type: 'nav_sync_failure' },
      }).catch(e => fastify.log.error({ err: e }, 'Failed to notify admins of sync failure'));
    } finally {
      isRunning[entity] = false;
      _checkAllDone();
    }
  };

  const tick = async () => {
    if (_isPaused) return;

    // Pre-check: se NAV non è ancora configurato, evita errori rumorosi ad ogni boot
    const host = await getConfig(prisma, 'integrations.nav.host', false);
    if (!host) {
      fastify.log.debug('NAV sync scheduler: host non configurato, tick saltato');
      return;
    }

    const syncEnabled = await getConfig(prisma, 'integrations.nav.syncEnabled', false);
    if (syncEnabled === 'false') {
      fastify.log.debug('NAV sync scheduler: sync globalmente disabilitato, tick saltato');
      return;
    }

    const now = Date.now();

    for (const entity of ENTITIES) {
      if (isRunning[entity]) continue;

      const filter = await prisma.navSyncFilter.findUnique({ where: { entity } });
      if (!filter?.autoSyncEnabled) continue;

      const intervalMs = (filter.intervalMinutes ?? 30) * 60 * 1000;
      const last = lastRunAt[entity] ?? 0;

      if (now - last >= intervalMs) {
        lastRunAt[entity] = now;
        void syncEntity(entity);
      }
    }
  };

  fastify.addHook('onReady', async () => {
    fastify.log.info('NAV sync scheduler: avviato (tick ogni 60s, intervalli per-entità)');

    // Prima esecuzione subito dopo il ready
    void tick();

    timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
  });

  fastify.addHook('onClose', async () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    await closePool();
    fastify.log.info('NAV sync scheduler: fermato, pool mssql chiuso');
  });
}
