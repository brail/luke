/**
 * Pino trace correlation: `pinoTraceMiddleware`, a Fastify `onRequest` hook that attaches
 * OpenTelemetry trace/span IDs and a business-level `x-luke-trace-id` to every request logger.
 */

import { randomUUID } from 'crypto';

import { trace } from '@opentelemetry/api';

import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Fastify `onRequest` hook that enriches the per-request Pino logger with trace context.
 *
 * Reads the active OpenTelemetry span and the `x-luke-trace-id` header (generating a UUID
 * if absent), attaches both to the child logger, and echoes `x-luke-trace-id` in the response
 * for front-end correlation.
 */
export function pinoTraceMiddleware(
  req: FastifyRequest,
  reply: FastifyReply,
  done: () => void
) {
  const span = trace.getActiveSpan();
  const spanContext = span?.spanContext();

  // Extracts or generates x-luke-trace-id (business identifier). A generated one is written back
  // onto the request, so every later reader — the tRPC context (and through it the audit rows) and
  // the error handler — gets this id instead of minting its own.
  const xTraceId = (req.headers['x-luke-trace-id'] as string) || randomUUID();
  req.headers['x-luke-trace-id'] = xTraceId;

  // Adds fields to the request-scoped logger
  req.log = req.log.child({
    traceId: spanContext?.traceId || 'n/a',
    spanId: spanContext?.spanId || 'n/a',
    xTraceId,
  });

  // Propagates header in response for FE correlation
  reply.header('x-luke-trace-id', xTraceId);

  done();
}
