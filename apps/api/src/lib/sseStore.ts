/**
 * SSE connection pool and short-lived ticket store.
 * State is in-memory and volatile (resets on restart), matching the pattern in presenceStore.ts.
 *
 * Auth strategy: the browser EventSource API cannot send custom headers.
 * Solution: a single-use ticket valid for 60 seconds is issued via tRPC before
 * the client opens the SSE connection, then exchanged for the user identity.
 */

import type { FastifyReply } from 'fastify';

// --- Connection pool ---

const connections = new Map<string, Set<FastifyReply>>();

function subscribe(userId: string, reply: FastifyReply): void {
  const set = connections.get(userId) ?? new Set();
  set.add(reply);
  connections.set(userId, set);
}

function unsubscribe(userId: string, reply: FastifyReply): void {
  const set = connections.get(userId);
  if (!set) return;
  set.delete(reply);
  if (set.size === 0) connections.delete(userId);
}

/**
 * Discriminated union of all SSE event shapes pushed to connected clients.
 */
export type SSEEvent =
  | { type: 'notification'; payload: Record<string, unknown> }
  | { type: 'sync-state'; entity: string; isRunning: boolean }
  | { type: 'calendar-updated'; seasonId: string }
  | { type: 'heartbeat' };

function pushToUser(userId: string, event: SSEEvent): void {
  const set = connections.get(userId);
  if (!set || set.size === 0) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const reply of set) {
    try {
      reply.raw.write(data);
    } catch {
      // Connection already closed — will be cleaned up on 'close' event
    }
  }
}

function pushToAll(event: SSEEvent): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const [, set] of connections.entries()) {
    for (const reply of set) {
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

interface Ticket {
  userId: string;
  expiresAt: number;
}

const tickets = new Map<string, Ticket>();
const TICKET_TTL_MS = 60_000;

function createTicket(ticketId: string, userId: string): void {
  tickets.set(ticketId, { userId, expiresAt: Date.now() + TICKET_TTL_MS });
}

function consumeTicket(ticketId: string): string | null {
  const ticket = tickets.get(ticketId);
  if (!ticket) return null;
  tickets.delete(ticketId); // monouso
  if (Date.now() > ticket.expiresAt) return null;
  return ticket.userId;
}

// Pulizia ticket scaduti ogni 5 minuti
setInterval(() => {
  const now = Date.now();
  for (const [id, ticket] of tickets) {
    if (now > ticket.expiresAt) tickets.delete(id);
  }
}, 5 * 60 * 1000);

/**
 * Singleton SSE store exposing the full connection pool and ticket API.
 *
 * - `subscribe` / `unsubscribe` — manage per-user reply sets.
 * - `pushToUser` — write an SSE event to all connections for a single user.
 * - `pushToAll` — broadcast an SSE event to every connected client.
 * - `connectedUserIds` — returns the list of user IDs with active connections.
 * - `createTicket` / `consumeTicket` — single-use 60-second auth tickets.
 */
export const sseStore = {
  subscribe,
  unsubscribe,
  pushToUser,
  pushToAll,
  connectedUserIds,
  createTicket,
  consumeTicket,
};
