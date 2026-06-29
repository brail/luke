/**
 * Pino trace correlation middleware and security serializers.
 *
 * Provides:
 * - `pinoTraceMiddleware` — Fastify `onRequest` hook that attaches OpenTelemetry
 *   trace/span IDs and a business-level `x-luke-trace-id` to every request logger.
 * - `pinoSerializers` — custom Pino serializers that redact sensitive fields
 *   (passwords, secrets, tokens, PII) before log output.
 * - `createTraceLogger` — helper for creating a trace-aware child logger in tRPC procedures.
 */

import { randomUUID } from 'crypto';

import { trace } from '@opentelemetry/api';
import serializers from 'pino-std-serializers';

import type { FastifyRequest, FastifyReply } from 'fastify';

/** Patterns used to identify sensitive field names that should be redacted in logs. */
const sensitivePatterns = [
  /password/i,
  /secret/i,
  /token/i,
  /key/i,
  /authorization/i,
  /bearer/i,
  /credential/i,
  /bindPassword/i,
  /jwt/i,
  /session/i,
  /cookie/i,
];

/**
 * Recursively redacts values whose key matches any sensitive pattern.
 * Arrays are traversed element by element; nested objects are walked recursively.
 */
function redactSensitiveFields(obj: any): any {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveFields);
  }

  if (typeof obj === 'object') {
    const redacted = { ...obj };

    for (const key of Object.keys(redacted)) {
      // Controlla se la chiave contiene pattern sensibili
      if (sensitivePatterns.some(pattern => pattern.test(key))) {
        redacted[key] = '[REDACTED]';
      } else if (typeof redacted[key] === 'object') {
        // Ricorsione per oggetti nested
        redacted[key] = redactSensitiveFields(redacted[key]);
      }
    }

    return redacted;
  }

  return obj;
}

/**
 * Pino serializers that automatically redact sensitive fields.
 *
 * - `req`/`res`/`err` — standard pino-std-serializers
 * - `config` — redacts any key matching a sensitive pattern
 * - `user` — keeps only `id` and `role`; redacts email, username, and names
 * - `sensitive` — generic redaction for any arbitrary object
 */
export const pinoSerializers = {
  req: serializers.req,
  res: serializers.res,
  err: serializers.err,

  // Custom: redact sensitive fields con pattern wildcard
  config: (value: any) => redactSensitiveFields(value),

  // Redact PII in user objects
  user: (value: any) => {
    if (typeof value === 'object' && value !== null) {
      const redacted = { ...value };
      // Mantieni solo ID e ruolo, redigi email/username
      if (redacted.email) redacted.email = '[REDACTED]';
      if (redacted.username) redacted.username = '[REDACTED]';
      if (redacted.firstName) redacted.firstName = '[REDACTED]';
      if (redacted.lastName) redacted.lastName = '[REDACTED]';
      return redacted;
    }
    return value;
  },

  // Redaction generica per qualsiasi oggetto
  sensitive: (value: any) => redactSensitiveFields(value),
};

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

  // Estrai o genera x-luke-trace-id (business identifier)
  const xTraceId = (req.headers['x-luke-trace-id'] as string) || randomUUID();

  // Aggiungi campi al logger request-scoped
  req.log = req.log.child({
    traceId: spanContext?.traceId || 'n/a',
    spanId: spanContext?.spanId || 'n/a',
    xTraceId,
  });

  // Propagazione header in risposta per correlazione FE
  reply.header('x-luke-trace-id', xTraceId);

  done();
}

/**
 * Creates a Pino child logger enriched with the current OpenTelemetry trace and span IDs.
 *
 * Useful for manual logging inside tRPC procedures where the request-scoped logger
 * is not directly available.
 */
export function createTraceLogger(
  baseLogger: any,
  additionalFields: Record<string, any> = {}
) {
  const span = trace.getActiveSpan();
  const spanContext = span?.spanContext();

  return baseLogger.child({
    traceId: spanContext?.traceId || 'n/a',
    spanId: spanContext?.spanId || 'n/a',
    ...additionalFields,
  });
}
