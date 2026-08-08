/**
 * Centralised error handling and response formatting for Luke API.
 * Registers Fastify's global error handler and exposes the tRPC error formatter.
 */

import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';

import { isProduction } from '@luke/core';

import { isRateLimitExceededCause } from './rateLimitError';

import type { Context } from './context';
import type { TRPCDefaultErrorShape, TRPCErrorFormatter } from '@trpc/server';
import type {
  FastifyInstance,
  FastifyError,
  FastifyRequest,
  FastifyReply,
} from 'fastify';

const isProd = isProduction();

/** Extracts a readable message from any caught value. */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Extracts a stable error code for audit logging: tRPC code, Prisma error code, or 'UNKNOWN'. */
export function toErrorCode(err: unknown): string {
  if (err instanceof TRPCError) return err.code;
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code;
  return 'UNKNOWN';
}

/**
 * Extracts the trace ID from the `x-luke-trace-id` request header,
 * falling back to the Fastify-assigned request ID.
 */
export function getTraceId(req: FastifyRequest): string | undefined {
  const header = req.headers['x-luke-trace-id'];
  return (Array.isArray(header) ? header[0] : header) || req.id;
}

function redactError(err: unknown): unknown {
  if (!err || typeof err !== 'object') return err;
  // The check above guarantees a non-null object: safe to treat it as a
  // record for redacting sensitive keys.
  const clone: Record<string, unknown> = { ...(err as Record<string, unknown>) };
  const redactKeys = [
    'stack',
    'password',
    'secret',
    'token',
    'bindDN',
    'credentials',
    'cause',
    'details',
  ];
  for (const k of redactKeys) {
    if (k in clone) clone[k] = '[REDACTED]';
  }
  return clone;
}

function mapHttpStatus(err: unknown): number {
  if (err instanceof TRPCError) {
    switch (err.code) {
      case 'BAD_REQUEST':
        return 400;
      case 'UNAUTHORIZED':
        return 401;
      case 'FORBIDDEN':
        return 403;
      case 'NOT_FOUND':
        return 404;
      case 'CONFLICT':
        return 409;
      default:
        return 500;
    }
  }
  const statusCode =
    err && typeof err === 'object' && 'statusCode' in err && typeof err.statusCode === 'number'
      ? err.statusCode
      : 500;
  if (statusCode >= 400 && statusCode <= 599) return statusCode;
  return 500;
}

function safeMessage(err: unknown): string {
  if (!isProd) return err instanceof Error ? err.message : 'Errore interno';
  // In produzione non esporre messaggi di back-end
  if (err instanceof TRPCError) {
    // Mantieni messaggi user-facing per errori noti
    if (
      [
        'BAD_REQUEST',
        'UNAUTHORIZED',
        'FORBIDDEN',
        'NOT_FOUND',
        'CONFLICT',
      ].includes(err.code)
    ) {
      return err.message || 'Richiesta non valida';
    }
  }
  return 'Internal server error';
}

function toResponseBody(err: unknown, traceId?: string) {
  const base: Record<string, unknown> = {
    error: true,
    message: safeMessage(err),
    code: err instanceof TRPCError ? err.code : 'INTERNAL_SERVER_ERROR',
    traceId,
  };
  if (!isProd) {
    base.stack = err instanceof Error ? err.stack : undefined;
  }
  return base;
}

/**
 * Registers the global Fastify error handler and `onError` hook.
 * Maps tRPC and HTTP errors to appropriate status codes, redacts sensitive fields
 * from error objects before logging, and suppresses stack traces in production.
 */
export function setGlobalErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
      const traceId = getTraceId(req);
      const status = mapHttpStatus(err);
      req.log.error({ err: redactError(err), traceId }, 'request failed');
      if (reply.sent) return;
      reply
        .code(status)
        .type('application/json')
        .send(toResponseBody(err, traceId));
    }
  );

  app.addHook('onError', (req, _reply, err, done) => {
    const traceId = getTraceId(req);
    req.log.error(
      {
        err: redactError(err),
        traceId,
        method: req.method,
        url: req.url,
        ip: req.ip,
      },
      'onError hook'
    );
    done();
  });
}

/**
 * Error shape returned to tRPC clients: `TRPCDefaultErrorShape` plus an optional
 * `retryAfterSeconds` on `data`, populated for `TOO_MANY_REQUESTS` errors so clients can
 * render an accurate `Retry-After` without recomputing the rate-limit window themselves.
 */
export interface LukeErrorShape extends TRPCDefaultErrorShape {
  data: TRPCDefaultErrorShape['data'] & { retryAfterSeconds?: number };
}

/**
 * tRPC error formatter compatible with `initTRPC.create({ errorFormatter })`.
 * Replaces internal error messages with a generic string in production, and surfaces
 * `retryAfterSeconds` for rate-limit errors (see `rateLimitError.ts`).
 */
export const trpcErrorFormatter: TRPCErrorFormatter<Context, LukeErrorShape> = ({ shape, error }) => {
  const retryAfterSeconds = isRateLimitExceededCause(error.cause)
    ? error.cause.retryAfterSeconds
    : undefined;

  return {
    ...shape,
    message: isProd ? 'Internal server error' : shape.message,
    data: {
      ...shape.data,
      ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
    },
  };
};
