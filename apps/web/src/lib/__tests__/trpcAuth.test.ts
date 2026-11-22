/**
 * The server-side client's requests as they leave the web server. A mutation is a POST, for which
 * tRPC sets `content-type` itself: a second one from this client would be joined to it
 * (`application/json, application/json`), which the API refuses with 415.
 */

import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createAuthedTrpcClient } = await import('../trpcAuth');

afterEach(() => vi.unstubAllGlobals());

it('sends a mutation with one JSON content type, the bearer and the forwarded client IP', async () => {
  const sent: Headers[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init?: Parameters<typeof fetch>[1]) => {
      sent.push(new Headers(init?.headers));
      return Response.json([{ result: { data: { success: true } } }]);
    })
  );

  await createAuthedTrpcClient('api-token', new Headers({ 'x-forwarded-for': '203.0.113.7' })).auth.logout.mutate();

  expect(sent).toHaveLength(1);
  expect(sent[0].get('content-type')).toBe('application/json');
  expect(sent[0].get('authorization')).toBe('Bearer api-token');
  expect(sent[0].get('x-forwarded-for')).toBe('203.0.113.7');
});
