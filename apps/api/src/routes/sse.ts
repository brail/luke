/**
 * Registers the SSE (Server-Sent Events) route for real-time push notifications.
 *
 * Endpoint: GET /api/sse?ticket=<ticket>
 *
 * Authentication uses a single-use ticket (60 s TTL) issued by `tRPC notifications.getSseTicket`.
 * EventSource browsers cannot send custom headers, so the ticket is passed as a query parameter.
 * The ticket carries the session it was issued from, and the stream lives only as long as that
 * session: it is checked when the stream opens and on every heartbeat (30 s, which also keeps the
 * connection alive through proxies), and the 12 h limit ends the stream on a timer of its own.
 */

import { SESSION_ABSOLUTE_LIFETIME_SECONDS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { isWithinSessionLifetime } from '../lib/auth';
import { sseStore, type SseSession } from '../lib/sseStore';
import { verifyTokenVersion } from '../lib/tokenVersionCache';

import type { FastifyInstance } from 'fastify';


const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * `true` while `session` may still receive pushes: within 12 h of its login, its version still the
 * user's, the user active. A revocation is seen by the first check that starts after it commits.
 */
export async function isSseSessionLive(session: SseSession, prisma: PrismaClient): Promise<boolean> {
  return (
    isWithinSessionLifetime(session.authTime) &&
    (await verifyTokenVersion(session.userId, session.tokenVersion, prisma))
  );
}

/**
 * Registers the SSE route on the given Fastify instance.
 *
 * Opens a persistent `text/event-stream` connection for the session the ticket carries. Sends a
 * `connected` event immediately, then a heartbeat after each successful check of the session, one
 * check at a time; ends the stream when a check refuses or fails, at 12 h from the login, and
 * cleans up the subscription when the client disconnects.
 *
 * @param options.heartbeatMs - Interval between the end of a check and the start of the next.
 */
export async function registerSseRoute(
  app: FastifyInstance,
  allowedOrigins: string[],
  { prisma, heartbeatMs = HEARTBEAT_INTERVAL_MS }: { prisma: PrismaClient; heartbeatMs?: number }
): Promise<void> {
  app.get<{ Querystring: { ticket?: string } }>('/api/sse', async (request, reply) => {
    const { ticket } = request.query;

    if (!ticket) {
      return reply.status(401).send({ error: 'Missing SSE ticket' });
    }

    const session = sseStore.consumeTicket(ticket);
    if (!session) {
      return reply.status(401).send({ error: 'Invalid or expired SSE ticket' });
    }

    // Before the stream exists: a refusal here is an ordinary 401, and an error the route's.
    if (!(await isSseSessionLive(session, prisma))) {
      return reply.status(401).send({ error: 'Session no longer valid' });
    }
    // A client that left during the check has already had its `close`, which a listener added
    // below would never see: the stream would stay subscribed with nobody on the other end.
    if (reply.raw.destroyed) return;

    // SSE headers — X-Accel-Buffering disables nginx/proxy buffering. `no-transform` keeps the
    // stream out of compression: apps/web's server compresses every response it proxies, rewrites
    // included, and gzip held the events — heartbeats too — in its buffer until the reverse proxy
    // timed the stream out (#135); `compression` skips a response marked `no-transform`.
    // reply.raw.writeHead() bypasses Fastify hooks (including @fastify/cors), so
    // Access-Control-Allow-Origin must be added manually. Origin is validated against the
    // same allowlist (buildCorsAllowedOrigins) used by the main @fastify/cors plugin,
    // not reflected indiscriminately.
    const origin = request.headers.origin;
    const headers: Record<string, string> = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    };
    if (origin && allowedOrigins.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
    }
    reply.raw.writeHead(200, headers);

    // Initial flush to confirm connection
    reply.raw.write('data: {"type":"connected"}\n\n');

    const { userId } = session;
    sseStore.subscribe(userId, reply);

    let closed = false;
    let heartbeatTimer: NodeJS.Timeout | undefined;
    // The 12 h limit needs no database: this timer ends the stream exactly then.
    const lifetimeTimer = setTimeout(
      () => end(),
      (session.authTime + SESSION_ABSOLUTE_LIFETIME_SECONDS) * 1000 - Date.now()
    );

    // Every way out goes through here once: no timer fires afterwards, and the reply leaves the
    // store before it is ended — a push landing between `end()` and `close` would write after end.
    const stop = (): boolean => {
      if (closed) return false;
      closed = true;
      clearTimeout(heartbeatTimer);
      clearTimeout(lifetimeTimer);
      sseStore.unsubscribe(userId, reply);
      return true;
    };
    const end = () => {
      if (stop()) reply.raw.end();
    };

    // Runs in a timer, outside any request: a rejection here would be unhandled, and
    // `gracefulShutdown` turns that into `exit(1)`. Re-armed only once a check has finished, so two
    // never overlap; one that resumes after the stream closed writes nothing.
    const beat = async () => {
      try {
        const live = await isSseSessionLive(session, prisma);
        if (closed) return;
        if (!live) return end();
        reply.raw.write('data: {"type":"heartbeat"}\n\n');
      } catch (err) {
        request.log.error({ err, userId }, 'SSE session check failed; ending the stream');
        end();
        return;
      }
      heartbeatTimer = setTimeout(() => void beat(), heartbeatMs);
    };
    heartbeatTimer = setTimeout(() => void beat(), heartbeatMs);

    // Backstop: an error emitted on the response is logged, never left without a listener.
    reply.raw.on('error', err => request.log.warn({ err, userId }, 'SSE stream error'));

    // Keep the connection open (do not call reply.send()) until the client disconnects or the
    // stream is ended; either way the response closes.
    await new Promise<void>(resolve => {
      reply.raw.on('close', () => {
        stop();
        resolve();
      });
    });
  });
}
