import type { FastifyInstance } from 'fastify';

import { sseStore } from '../lib/sseStore';

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * GET /api/sse?ticket=<ticket>
 *
 * Autenticazione via ticket monouso (60s TTL) emesso da tRPC notifications.getSseTicket.
 * EventSource browser non supporta header custom → ticket in query param.
 */
export async function registerSseRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { ticket?: string } }>('/api/sse', async (request, reply) => {
    const { ticket } = request.query;

    if (!ticket) {
      return reply.status(401).send({ error: 'Missing SSE ticket' });
    }

    const userId = sseStore.consumeTicket(ticket);
    if (!userId) {
      return reply.status(401).send({ error: 'Invalid or expired SSE ticket' });
    }

    // SSE headers — X-Accel-Buffering disabilita buffering nginx/proxy
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Flush iniziale per confermare connessione
    reply.raw.write('data: {"type":"connected"}\n\n');

    sseStore.subscribe(userId, reply);

    // Heartbeat ogni 30s per mantenere connessione viva attraverso proxy
    const heartbeatTimer = setInterval(() => {
      try {
        reply.raw.write('data: {"type":"heartbeat"}\n\n');
      } catch {
        clearInterval(heartbeatTimer);
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Cleanup su disconnect client
    reply.raw.on('close', () => {
      clearInterval(heartbeatTimer);
      sseStore.unsubscribe(userId, reply);
    });

    // Tieni la connessione aperta (non chiamare reply.send())
    await new Promise<void>(resolve => {
      reply.raw.on('close', resolve);
    });
  });
}
