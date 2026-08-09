/**
 * Registers the SSE (Server-Sent Events) route for real-time push notifications.
 *
 * Endpoint: GET /api/sse?ticket=<ticket>
 *
 * Authentication uses a single-use ticket (60 s TTL) issued by `tRPC notifications.getSseTicket`.
 * EventSource browsers cannot send custom headers, so the ticket is passed as a query parameter.
 * A heartbeat event is sent every 30 seconds to keep the connection alive through proxies.
 */

import { sseStore } from '../lib/sseStore';

import type { FastifyInstance } from 'fastify';


const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Registers the SSE route on the given Fastify instance.
 *
 * Opens a persistent `text/event-stream` connection for the authenticated user identified
 * by the ticket. Sends a `connected` event immediately, heartbeats every 30 s, and
 * cleans up the subscription when the client disconnects.
 */
export async function registerSseRoute(
  app: FastifyInstance,
  allowedOrigins: string[]
): Promise<void> {
  app.get<{ Querystring: { ticket?: string } }>('/api/sse', async (request, reply) => {
    const { ticket } = request.query;

    if (!ticket) {
      return reply.status(401).send({ error: 'Missing SSE ticket' });
    }

    const userId = sseStore.consumeTicket(ticket);
    if (!userId) {
      return reply.status(401).send({ error: 'Invalid or expired SSE ticket' });
    }

    // SSE headers — X-Accel-Buffering disables nginx/proxy buffering.
    // reply.raw.writeHead() bypasses Fastify hooks (including @fastify/cors), so
    // Access-Control-Allow-Origin must be added manually. Origin is validated against the
    // same allowlist (buildCorsAllowedOrigins) used by the main @fastify/cors plugin,
    // not reflected indiscriminately.
    const origin = request.headers.origin;
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    };
    if (origin && allowedOrigins.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
    }
    reply.raw.writeHead(200, headers);

    // Initial flush to confirm connection
    reply.raw.write('data: {"type":"connected"}\n\n');

    sseStore.subscribe(userId, reply);

    // Heartbeat every 30s to keep connection alive through proxies
    const heartbeatTimer = setInterval(() => {
      try {
        reply.raw.write('data: {"type":"heartbeat"}\n\n');
      } catch {
        clearInterval(heartbeatTimer);
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Cleanup on client disconnect
    reply.raw.on('close', () => {
      clearInterval(heartbeatTimer);
      sseStore.unsubscribe(userId, reply);
    });

    // Keep the connection open (do not call reply.send())
    await new Promise<void>(resolve => {
      reply.raw.on('close', resolve);
    });
  });
}
