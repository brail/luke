/**
 * Health and readiness probe routes:
 *  - GET /livez      — liveness (always 200 if the process is running)
 *  - GET /readyz     — readiness (runs all registered checks, 503 if any fail)
 *  - GET /healthz    — target of the API container healthcheck in the compose files (Docker, Portainer)
 *  - GET /api/health — status, timestamp and uptime, for manual checks
 *  - GET /           — root discovery endpoint listing the available endpoints
 *
 * None of them is authenticated, so none tells the application's name, version or environment (#57).
 */

import type { PrismaClient } from '@luke/db';

import { runReadinessChecks } from '../observability/readiness';

import type { FastifyInstance } from 'fastify';

export function registerHealthRoutes(fastify: FastifyInstance, prisma: PrismaClient): void {
  // Liveness: process alive (always 200 if the process is alive)
  fastify.get('/livez', async () => ({ status: 'ok' }));

  // Readiness: system ready to serve requests
  fastify.get('/readyz', async (request, reply) => {
    const result = await runReadinessChecks(prisma, request.log);

    if (!result.allOk) reply.status(503);

    return {
      status: result.allOk ? 'ready' : 'unready',
      timestamp: result.timestamp,
      checks: result.checks, // OK to expose status for K8s debugging
    };
  });

  // Container healthcheck target (docker-compose.*.yml): the API's reported health depends on it
  fastify.get('/healthz', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  fastify.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  }));

  // Root route for compatibility
  fastify.get('/', async () => ({
    message: 'API is running',
    endpoints: {
      health: '/api/health',
      livez: '/livez',
      readyz: '/readyz',
      trpc: '/trpc',
      docs: 'https://trpc.io/docs',
    },
  }));

  if (process.env.NODE_ENV === 'test') {
    fastify.get('/__test__/boom', async () => {
      throw new Error('Boom test error');
    });
  }
}
