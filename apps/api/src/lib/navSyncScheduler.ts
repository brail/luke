/**
 * Scheduler per la sincronizzazione periodica NAV → DB locale.
 *
 * Avvio: hook onReady di Fastify (dopo che il server è in ascolto).
 * Arresto: hook onClose di Fastify (ferma l'intervallo e chiude il pool mssql).
 *
 * L'intervallo viene letto da AppConfig (`integrations.nav.syncIntervalMinutes`).
 * Un errore di sync non causa il crash del server: viene loggato e il ciclo
 * successivo parte normalmente.
 */

import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

import { closePool, runNavSync } from '@luke/nav';

import { getConfig } from './configManager';

const DEFAULT_INTERVAL_MINUTES = 30;

export function registerNavSyncScheduler(
  fastify: FastifyInstance,
  prisma: PrismaClient,
): void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let isRunning = false;

  const runSync = async () => {
    // Evita sync concorrenti (scheduler + manuale on-demand simultanei)
    if (isRunning) {
      fastify.log.warn('NAV sync scheduler: sync già in corso, skip');
      return;
    }

    // Pre-check: se NAV non è ancora configurato, evita l'errore rumoroso
    // "Configurazione NAV incompleta" che si verificherebbe ad ogni boot
    const host = await getConfig(prisma, 'integrations.nav.host', false);
    if (!host) {
      fastify.log.debug('NAV sync scheduler: host non configurato, sync saltato');
      return;
    }

    isRunning = true;
    fastify.log.info('NAV sync scheduler: avvio sync');

    try {
      const report = await runNavSync(prisma, getConfig);

      const durationMs =
        report.completedAt.getTime() - report.startedAt.getTime();

      if (report.results.length === 0) {
        fastify.log.info(
          { durationMs },
          'NAV sync scheduler: sync saltato (syncEnabled=false)',
        );
        return;
      }

      for (const r of report.results) {
        if (r.skipped) {
          fastify.log.info(
            { entity: r.entity },
            'NAV sync scheduler: entità saltata (filtro disabilitato)',
          );
        } else {
          fastify.log.info(
            { entity: r.entity, upserted: r.upserted, durationMs },
            'NAV sync scheduler: entità completata',
          );
        }
      }

      const totalUpserted = report.results.reduce(
        (sum, r) => sum + r.upserted,
        0,
      );
      fastify.log.info(
        { totalUpserted, durationMs },
        'NAV sync scheduler: sync completato',
      );
    } catch (err) {
      fastify.log.error({ err }, 'NAV sync scheduler: sync fallito');
    } finally {
      isRunning = false;
    }
  };

  fastify.addHook('onReady', async () => {
    const rawInterval = await getConfig(
      prisma,
      'integrations.nav.syncIntervalMinutes',
      false,
    );
    const intervalMinutes =
      rawInterval !== null ? parseInt(rawInterval, 10) : DEFAULT_INTERVAL_MINUTES;
    const intervalMs =
      (Number.isFinite(intervalMinutes) && intervalMinutes > 0
        ? intervalMinutes
        : DEFAULT_INTERVAL_MINUTES) *
      60 *
      1000;

    fastify.log.info(
      { intervalMinutes: intervalMs / 60_000 },
      'NAV sync scheduler: avviato',
    );

    // Prima esecuzione subito dopo il ready
    void runSync();

    timer = setInterval(() => void runSync(), intervalMs);
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
