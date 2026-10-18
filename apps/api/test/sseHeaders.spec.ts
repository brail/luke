/**
 * The SSE stream over real HTTP: its headers keep it out of compression, which apps/web's server
 * applies to every response it proxies (#135). A gzip stream held the events in its buffer.
 */

import { get, type IncomingMessage } from 'http';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, expect, it } from 'vitest';

import { sseStore } from '../src/lib/sseStore';
import { registerSseRoute } from '../src/routes/sse';

let app: FastifyInstance;
afterEach(() => app.close());

it('marks the event stream no-transform, so no proxy compresses it', async () => {
  app = Fastify();
  await registerSseRoute(app, []);
  const url = await app.listen({ port: 0, host: '127.0.0.1' });
  sseStore.createTicket('sse-headers-ticket', 'user-1');

  const response = await new Promise<IncomingMessage>((resolve, reject) =>
    get(`${url}/api/sse?ticket=sse-headers-ticket`, resolve).on('error', reject)
  );
  response.destroy();

  expect(response.statusCode).toBe(200);
  expect(response.headers['content-type']).toBe('text/event-stream');
  expect(response.headers['cache-control']?.split(',').map(d => d.trim())).toContain('no-transform');
});
