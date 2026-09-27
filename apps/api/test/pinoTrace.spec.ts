/**
 * One trace id per request. Without an incoming `x-luke-trace-id`, the logging hook, the tRPC
 * context (whose id the audit rows carry) and the error handler each made up their own, so an
 * audit row could not be matched to its log lines or to the id the client received.
 */

import { describe, it, expect, vi } from 'vitest';

import { pinoTraceMiddleware } from '../src/observability/pinoTrace';

import type { FastifyReply, FastifyRequest } from 'fastify';

function run(headers: Record<string, string>) {
  // Only the fields the hook touches; a full Fastify request is irrelevant here.
  const req = { headers, log: { child: () => ({}) } } as unknown as FastifyRequest;
  const header = vi.fn();
  pinoTraceMiddleware(req, { header } as unknown as FastifyReply, () => {});
  return { req, sent: header.mock.calls[0]?.[1] as string };
}

describe('pinoTraceMiddleware', () => {
  it('writes a generated id back onto the request, so later readers get the same one', () => {
    const { req, sent } = run({});

    expect(sent).toMatch(/^[0-9a-f-]{36}$/);
    expect(req.headers['x-luke-trace-id']).toBe(sent);
  });

  it('keeps an incoming id', () => {
    const { req, sent } = run({ 'x-luke-trace-id': 'from-client' });

    expect(sent).toBe('from-client');
    expect(req.headers['x-luke-trace-id']).toBe('from-client');
  });
});
