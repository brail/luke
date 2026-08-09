/**
 * Scheduler for periodic NAV → local DB synchronization.
 *
 * Start: Fastify `onReady` hook (after the server is listening).
 * Stop: Fastify `onClose` hook (stops the timer and closes the mssql pool).
 *
 * Design:
 * - Global tick every minute.
 * - On each tick, for every entity (vendor, brand, season): if autoSyncEnabled=true
 *   and at least intervalMinutes have passed since the last run, start the sync.
 * - The filter is re-read from the DB on every tick: changes to the interval or
 *   the enable flag take effect on the next tick (within 1 minute), with no restart.
 *
 * A sync error doesn't crash the server: it's logged and the next cycle starts
 * normally.
 */


import { closePool, runNavSync } from '@luke/nav';

import { getConfig } from './configManager';
import { toErrorMessage } from './error';
import { guardMaintenance } from './maintenanceMode';
import { notifyAdmins, notifyDeduped, SYSTEM_FAILURE_DEDUP_MS } from './notifications';
import { withSchedulerLock } from './schedulerLock';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

const TICK_INTERVAL_MS = 60 * 1000; // 1 minute

const ENTITIES = ['vendor', 'brand', 'season'] as const;
export type Entity = (typeof ENTITIES)[number];

// Timestamp (ms) of the last completed run per entity
const lastRunAt: Partial<Record<Entity, number>> = {};

// Per-entity flag: avoids concurrent syncs
const isRunning: Partial<Record<Entity, boolean>> = {};

/**
 * Waits for the in-progress sync (if any) to finish and blocks new runs from starting.
 * Used by saveConfig before closePool() to avoid a null pool mid-operation.
 * Call resumeNavScheduler() afterwards to reopen the semaphore.
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
  // Wait for all in-progress entities to finish
  const running = ENTITIES.filter(e => isRunning[e]);
  if (running.length === 0) return;
  return new Promise(resolve => {
    _pauseResolve = resolve;
    // resolve is called in _checkAllDone() when all entities complete
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

      await prisma.navSyncFilter
        .update({
          where: { entity },
          data: { lastSyncStatus: 'SUCCESS', lastSyncError: null, lastSyncAt: new Date() },
        })
        .catch(e => fastify.log.error({ err: e, entity }, 'Failed to persist NAV sync status'));
    } catch (err) {
      fastify.log.error({ err, entity }, 'NAV sync scheduler: sync fallito');
      await prisma.navSyncFilter
        .update({
          where: { entity },
          data: {
            lastSyncStatus: 'FAILURE',
            lastSyncError: toErrorMessage(err).slice(0, 500),
            lastSyncAt: new Date(),
          },
        })
        .catch(e => fastify.log.error({ err: e, entity }, 'Failed to persist NAV sync failure status'));
      await notifyDeduped(prisma, `nav-sync:failure:${entity}`, SYSTEM_FAILURE_DEDUP_MS, () => notifyAdmins(prisma, {
        category: 'SYSTEM',
        title: `NAV sync ${entity} fallito`,
        message: toErrorMessage(err),
        data: { entity, type: 'nav_sync_failure' },
      })).catch(e => fastify.log.error({ err: e }, 'Failed to notify admins of sync failure'));
    } finally {
      isRunning[entity] = false;
      _checkAllDone();
    }
  };

  const tick = async () => {
    if (_isPaused) return;

    // Pre-check: if NAV isn't configured yet, avoid noisy errors on every boot
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
        // Locked around syncEntity (not the outer tick): syncEntity is fire-and-forget from here,
        // so the tick itself returns almost instantly — the lock must span the actual sync work,
        // which withSchedulerLock's try/finally does regardless of when its caller stops awaiting it.
        void withSchedulerLock(prisma, `nav-sync:${entity}`, () => syncEntity(entity))();
      }
    }
  };

  const guardedTick = guardMaintenance(prisma, tick);

  fastify.addHook('onReady', async () => {
    fastify.log.info('NAV sync scheduler: avviato (tick ogni 60s, intervalli per-entità)');

    // First run right after ready
    void guardedTick();

    timer = setInterval(() => void guardedTick(), TICK_INTERVAL_MS);
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
