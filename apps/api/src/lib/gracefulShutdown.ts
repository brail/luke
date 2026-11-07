/**
 * The process's one shutdown path, for SIGTERM and SIGINT and for an uncaught exception or an
 * unhandled rejection.
 *
 * Closes Fastify (which runs every `onClose` hook), waits for background work (`runInBackground`)
 * while keeping 1 s for the disconnect, and disconnects Prisma, all within 5 s, then —
 * whatever that did — shuts telemetry down within 2 s, then exits: 0 after a clean signal
 * shutdown, 1 otherwise. 7 s in all, inside the 10 s `docker stop` waits before it kills.
 */

import { setTimeout as delay } from 'timers/promises';

import type { PrismaClient } from '@luke/db';

import { backgroundWorkIdle } from './backgroundWork';
import { toErrorMessage } from './error';

import type { FastifyInstance } from 'fastify';

const CLOSE_TIMEOUT_MS = 5_000;
/** What the background wait leaves of the close budget, for the disconnect. */
const DISCONNECT_RESERVE_MS = 1_000;
const TELEMETRY_TIMEOUT_MS = 2_000;

export interface GracefulShutdownDeps {
  fastify: FastifyInstance;
  prisma: Pick<PrismaClient, '$disconnect'>;
  /** Stops the in-memory stores' cleanup intervals before the server closes. */
  stopStores: () => void;
  /** Flushes telemetry; must not throw. */
  shutdownTelemetry: () => Promise<void>;
}

/** Rejects after `ms`, without keeping the process alive. */
function timeout(ms: number, what: string): Promise<never> {
  return delay(ms, undefined, { ref: false }).then(() => {
    throw new Error(`${what} timeout`);
  });
}

/** Closes the server and the database, then telemetry in any case; true if the first part was clean. */
export async function closeAll({
  fastify,
  prisma,
  shutdownTelemetry,
}: Omit<GracefulShutdownDeps, 'stopStores'>): Promise<boolean> {
  let clean = true;
  const deadline = Date.now() + CLOSE_TIMEOUT_MS;
  try {
    await Promise.race([
      (async () => {
        await fastify.close();
        // Work a request started without waiting for it, such as a replaced logo's cleanup, may
        // still need the database. It gets what the server close left of the budget; a task past
        // that is given up and logged (#198).
        await backgroundWorkIdle(Math.max(0, deadline - Date.now() - DISCONNECT_RESERVE_MS)).catch(err =>
          fastify.log.warn(`Background work given up at shutdown: ${toErrorMessage(err)}`)
        );
        await prisma.$disconnect();
      })(),
      timeout(CLOSE_TIMEOUT_MS, 'close'),
    ]);
  } catch (err) {
    clean = false;
    fastify.log.error({ err }, 'Error during shutdown');
  }
  await Promise.race([shutdownTelemetry(), timeout(TELEMETRY_TIMEOUT_MS, 'telemetry shutdown')])
    .catch(err => fastify.log.error({ err }, 'Error during telemetry shutdown'));
  return clean;
}

export function setupGracefulShutdown(deps: GracefulShutdownDeps): void {
  const { fastify, stopStores } = deps;

  const gracefulShutdown = async (signal: string) => {
    fastify.log.info(`Received signal ${signal}, starting graceful shutdown...`);
    stopStores();
    const clean = await closeAll(deps);
    fastify.log.info('Shutdown completed');
    process.exit(clean ? 0 : 1);
  };

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

  const onFatal = async (reason: unknown, type: string) => {
    fastify.log.fatal({ err: reason }, `${type}: shutting down`);
    await closeAll(deps);
    process.exit(1);
  };

  process.on('uncaughtException', error => void onFatal(error, 'uncaughtException'));
  process.on('unhandledRejection', reason => void onFatal(reason, 'unhandledRejection'));
}
