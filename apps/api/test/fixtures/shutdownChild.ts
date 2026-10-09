/**
 * Child process for `gracefulShutdown.spec.ts`: a Fastify instance with the real shutdown path and
 * an `onClose` hook that prints `onClose ran`, started the way the API starts (with `instrument.ts`
 * preloaded). Prints `ready` once it can take a signal.
 */

import Fastify from 'fastify';

import { shutdownTelemetry } from '../../src/instrument';
import { setupGracefulShutdown } from '../../src/lib/gracefulShutdown';

const fastify = Fastify();
fastify.addHook('onClose', async () => {
  process.stdout.write('onClose ran\n');
});
setupGracefulShutdown({ fastify, prisma: { $disconnect: async () => {} }, stopStores: () => {}, shutdownTelemetry });

// Listening, like the server: it is what keeps the process alive until the signal.
void fastify.listen({ port: 0, host: '127.0.0.1' }).then(() => process.stdout.write('ready\n'));
