/**
 * SSE connection pool + short-lived ticket store.
 * Pattern identico a presenceStore.ts (Map in-memory, volatile al restart).
 *
 * Auth SSE: EventSource browser non supporta header custom.
 * Soluzione: ticket monouso valido 60s, scambiato via tRPC prima di aprire SSE.
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

export type SSEEvent =
  | { type: 'notification'; payload: Record<string, unknown> }
  | { type: 'sync-state'; entity: string; isRunning: boolean }
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

export const sseStore = {
  subscribe,
  unsubscribe,
  pushToUser,
  pushToAll,
  connectedUserIds,
  createTicket,
  consumeTicket,
};
