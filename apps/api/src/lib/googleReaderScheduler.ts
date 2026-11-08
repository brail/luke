import type { PrismaClient } from '@luke/db';

import { reconcileGoogleReaders } from '../services/googleCalendarSync.service';

import { guardMaintenance } from './maintenanceMode';
import { withSchedulerLock } from './schedulerLock';

import type { FastifyInstance } from 'fastify';

// ponytail: fixed pace, no AppConfig key. A reader who lost access in Luke keeps it in Google for
// at most this long; add a key (or reconcile right after each audience change) if that is too slow.
const TICK_INTERVAL_MS = 10 * 60 * 1000;

/** First pass soon after start-up, so a deploy reconciles every calendar without waiting a tick. */
const FIRST_RUN_DELAY_MS = 30_000;

/**
 * Registers the Google Calendar reader reconcile (`reconcileGoogleReaders`) as a Fastify plugin:
 * once shortly after start-up, then every 10 minutes. Same lock and maintenance guard as the other
 * tick-based schedulers. Without Google credentials a pass does nothing.
 */
export function registerGoogleReaderScheduler(fastify: FastifyInstance, prisma: PrismaClient): void {
  let firstRun: ReturnType<typeof setTimeout> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const guardedTick = guardMaintenance(
    prisma,
    withSchedulerLock(prisma, 'google-readers', async () => {
      const result = await reconcileGoogleReaders(prisma, fastify.log);
      if (!result) fastify.log.debug('Google Calendar readers: Google not configured, nothing to reconcile');
    })
  );
  const run = () =>
    guardedTick().catch(err => fastify.log.error({ err }, 'Google Calendar readers: reconcile failed'));

  fastify.addHook('onReady', async () => {
    fastify.log.info({ intervalMs: TICK_INTERVAL_MS }, 'Google Calendar reader scheduler: started');
    firstRun = setTimeout(() => void run(), FIRST_RUN_DELAY_MS);
    timer = setInterval(() => void run(), TICK_INTERVAL_MS);
  });

  fastify.addHook('onClose', async () => {
    if (firstRun !== null) clearTimeout(firstRun);
    if (timer !== null) clearInterval(timer);
    firstRun = null;
    timer = null;
    fastify.log.info('Google Calendar reader scheduler: stopped');
  });
}
