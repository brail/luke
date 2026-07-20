/**
 * Periodic flush of the in-memory calendar-notification aggregation buffer.
 *
 * `notifyCalendarChange` (in `./notifications`) enqueues instead of sending immediately;
 * this scheduler flushes entries whose buffer window has elapsed, collapsing bursts of
 * calendar mutations by the same actor into a single aggregated notification.
 *
 * Design mirrors the other schedulers in this directory: global tick via `setInterval`,
 * started on `onReady`, cleared on `onClose`. On `onClose` the buffer is also force-flushed
 * so a graceful shutdown doesn't drop notifications still waiting for their window to elapse.
 */

import { flushDueCalendarNotifications, flushAllCalendarNotifications } from './notifications';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

const TICK_INTERVAL_MS = 30 * 1000;

/**
 * Registers the calendar-notification buffer flusher as a Fastify plugin.
 * Starts a 30-second tick on `onReady`; force-flushes the buffer on `onClose`.
 */
export function registerCalendarNotificationBuffer(
  fastify: FastifyInstance,
  prisma: PrismaClient,
): void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () =>
    flushDueCalendarNotifications(prisma, fastify.log).catch(err =>
      fastify.log.error({ err }, 'Calendar notification buffer: errore non gestito')
    );

  fastify.addHook('onReady', async () => {
    fastify.log.info('Calendar notification buffer: avviato (tick ogni 30s, finestra 3 min)');
    timer = setInterval(() => void tick(), TICK_INTERVAL_MS);
  });

  fastify.addHook('onClose', async () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    await flushAllCalendarNotifications(prisma, fastify.log);
    fastify.log.info('Calendar notification buffer: fermato, buffer svuotato');
  });
}
