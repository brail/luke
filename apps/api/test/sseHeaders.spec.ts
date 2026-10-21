/**
 * The SSE stream over real HTTP: its headers keep it out of compression, which apps/web's server
 * applies to every response it proxies (#135). A gzip stream held the events in its buffer.
 */

import { get, type IncomingMessage } from 'http';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { sseStore } from '../src/lib/sseStore';
import * as tokenVersionCache from '../src/lib/tokenVersionCache';
import { registerSseRoute } from '../src/routes/sse';

let app: FastifyInstance;
afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
});

it('marks the event stream no-transform, so no proxy compresses it', async () => {
  // No database here: the session check at open answers live (`sseSession.integration.spec.ts` covers it).
  vi.spyOn(tokenVersionCache, 'verifyTokenVersion').mockResolvedValue(true);
  app = Fastify();
  // The stub is never read: `verifyTokenVersion`, its only reader, is stubbed above.
  await registerSseRoute(app, [], { prisma: {} as PrismaClient, heartbeatMs: 60_000 });
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  sseStore.createTicket('sse-headers-ticket', {
    userId: 'user-1',
    tokenVersion: 0,
    authTime: Math.floor(Date.now() / 1000),
  });

  const response = await new Promise<IncomingMessage>((resolve, reject) =>
    get(`${url}/api/sse?ticket=sse-headers-ticket`, resolve).on('error', reject)
  );
  response.destroy();

  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('text/event-stream');
  expect(response.headers['cache-control']?.split(',').map(d => d.trim())).toContain('no-transform');
});
