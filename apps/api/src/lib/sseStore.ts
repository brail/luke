/**
 * SSE connection pool and short-lived ticket store.
 * State is in-memory and volatile (resets on restart), matching the pattern in presenceStore.ts.
 *
 * Auth strategy: the browser EventSource API cannot send custom headers.
 * Solution: a single-use ticket valid for 60 seconds is issued via tRPC before
 * the client opens the SSE connection, then exchanged for the session it was issued from, which the
 * route re-checks for as long as the stream stays open (`routes/sse.ts`).
 */

import type { MaintenanceModeStatus } from '@luke/core';

import type { FastifyReply } from 'fastify';

// --- Connection pool ---

/** Each user's open streams, with the route's way to end each one (`routes/sse.ts`). */
const connections = new Map<string, Map<FastifyReply, () => void>>();

function subscribe(userId: string, reply: FastifyReply, end: () => void): void {
  const streams = connections.get(userId) ?? new Map();
  streams.set(reply, end);
  connections.set(userId, streams);
}

function unsubscribe(userId: string, reply: FastifyReply): void {
  const streams = connections.get(userId);
  if (!streams) return;
  streams.delete(reply);
  if (streams.size === 0) connections.delete(userId);
}

/**
 * Ends every open stream of `userId`, after its sessions were revoked (`sessionRevocation.ts`). Each
 * `end` unsubscribes its stream first, so nothing is written to it afterwards; one that throws does
 * not keep the others open.
 */
function endUser(userId: string): void {
  for (const end of [...(connections.get(userId)?.values() ?? [])]) {
    try {
      end();
    } catch {
      // Already closing: its 'close' event cleans up.
    }
  }
}

/**
 * Discriminated union of all SSE event shapes pushed to connected clients.
 */
export type SSEEvent =
  | { type: 'notification'; payload: Record<string, unknown> }
  | { type: 'sync-state'; entity: string; isRunning: boolean }
  | { type: 'calendar-updated'; seasonId: string }
  | { type: 'maintenance-mode'; status: MaintenanceModeStatus; scheduledAt: string | null; message: string | null }
  | { type: 'connected' } // Written by the route on every open (`routes/sse.ts`).
  | { type: 'heartbeat' }
  // The user's sessions were revoked: the web signs out (ADR-052). Its streams end right after.
  | { type: 'session-revoked' };

function pushToUser(userId: string, event: SSEEvent): void {
  const streams = connections.get(userId);
  if (!streams) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const reply of streams.keys()) {
    try {
      reply.raw.write(data);
    } catch {
      // Connection already closed — will be cleaned up on 'close' event
    }
  }
}

function pushToAll(event: SSEEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const streams of connections.values()) {
    for (const reply of streams.keys()) {
      try {
        reply.raw.write(data);
      } catch {
        // Connection already closed — will be cleaned up on 'close' event
      }
    }
  }
}

function connectedUserIds(): string[] {
  return Array.from(connections.keys());
}

// --- Ticket store ---

/** The session a ticket was issued from: what the stream it opens is checked against. */
export interface SseSession {
  userId: string;
  tokenVersion: number;
  /** Unix seconds of the login the session descends from. */
  authTime: number;
}

interface Ticket {
  session: SseSession;
  expiresAt: number;
}

const tickets = new Map<string, Ticket>();
const TICKET_TTL_MS = 60_000;

function createTicket(ticketId: string, session: SseSession): void {
  tickets.set(ticketId, { session, expiresAt: Date.now() + TICKET_TTL_MS });
}

function consumeTicket(ticketId: string): SseSession | null {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;
  tickets.delete(ticketId); // single-use
  if (Date.now() > ticket.expiresAt) return null;
  return ticket.session;
}

// Cleans up expired tickets every 5 minutes. `unref`: the server is kept alive by its listener, and
// a timer of its own would keep alive any other process that imports this module through the
// notifications — a CLI script never exited.
setInterval(() => {
  const now = Date.now();
  for (const [id, ticket] of tickets) {
    if (now > ticket.expiresAt) tickets.delete(id);
  }
}, 5 * 60 * 1000).unref();

/**
 * Singleton SSE store exposing the full connection pool and ticket API.
 *
 * - `subscribe` / `unsubscribe` — manage per-user streams; `endUser` ends them all.
 * - `pushToUser` — write an SSE event to all connections for a single user.
 * - `pushToAll` — broadcast an SSE event to every connected client.
 * - `connectedUserIds` — returns the list of user IDs with active connections.
 * - `createTicket` / `consumeTicket` — single-use 60-second tickets carrying the issuing session.
 */
export const sseStore = {
  subscribe,
  unsubscribe,
  endUser,
  pushToUser,
  pushToAll,
  connectedUserIds,
  createTicket,
  consumeTicket,
};
