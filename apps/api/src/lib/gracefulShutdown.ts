/**
 * The process's one shutdown path, for SIGTERM and SIGINT and for an uncaught exception or an
 * unhandled rejection.
 *
 * Closes Fastify (which runs every `onClose` hook) and disconnects Prisma within 5 s, then —
 * whatever that did — shuts telemetry down within 2 s, then exits: 0 after a clean signal
 * shutdown, 1 otherwise. 7 s in all, inside the 10 s `docker stop` waits before it kills.
 */

import { setTimeout as delay } from 'timers/promises';

import type { PrismaClient } from '@luke/db';

import type { FastifyInstance } from 'fastify';

const CLOSE_TIMEOUT_MS = 5_000;
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

export function setupGracefulShutdown({ fastify, prisma, stopStores, shutdownTelemetry }: GracefulShutdownDeps): void {
  /** Closes the server and the database, then telemetry in any case; true if the first part was clean. */
  const closeAll = async (): Promise<boolean> => {
    let clean = true;
    try {
      await Promise.race([
        (async () => {
          await fastify.close();
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
  };

  const gracefulShutdown = async (signal: string) => {
    fastify.log.info(`Received signal ${signal}, starting graceful shutdown...`);
    stopStores();
    const clean = await closeAll();
    fastify.log.info('Shutdown completed');
    process.exit(clean ? 0 : 1);
  };

  process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => void gracefulShutdown('SIGINT'));

  const onFatal = async (reason: unknown, type: string) => {
    fastify.log.fatal({ reason }, `${type}: shutting down`);
    await closeAll();
    process.exit(1);
  };

  process.on('uncaughtException', error => void onFatal(error, 'uncaughtException'));
  process.on('unhandledRejection', reason => void onFatal(reason, 'unhandledRejection'));
}
