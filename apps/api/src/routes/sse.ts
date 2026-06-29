/**
 * Registers the SSE (Server-Sent Events) route for real-time push notifications.
 *
 * Endpoint: GET /api/sse?ticket=<ticket>
 *
 * Authentication uses a single-use ticket (60 s TTL) issued by `tRPC notifications.getSseTicket`.
 * EventSource browsers cannot send custom headers, so the ticket is passed as a query parameter.
 * A heartbeat event is sent every 30 seconds to keep the connection alive through proxies.
 */

import type { FastifyInstance } from 'fastify';

import { sseStore } from '../lib/sseStore';

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Registers the SSE route on the given Fastify instance.
 *
 * Opens a persistent `text/event-stream` connection for the authenticated user identified
 * by the ticket. Sends a `connected` event immediately, heartbeats every 30 s, and
 * cleans up the subscription when the client disconnects.
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
