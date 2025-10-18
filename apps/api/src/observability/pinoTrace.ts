/**
 * Pino Trace Correlation & Security Serializers
 * Middleware per correlazione log-trace e redaction PII/secrets
 */

import { trace } from '@opentelemetry/api';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'crypto';
import serializers from 'pino-std-serializers';

/**
 * Pattern per identificare campi sensibili da redigere
 */
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
 * Funzione helper per redigere oggetti nested ricorsivamente
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
 * Serializer con redaction automatica di campi sensibili
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
 * Middleware per correlazione trace ID con log Pino
 * Legge span attivo da OpenTelemetry e x-luke-trace-id header
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
 * Helper per creare child logger con trace context
 * Utile per logging manuale in procedure tRPC
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
