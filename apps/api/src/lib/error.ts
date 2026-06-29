/**
 * Centralised error handling and response formatting for Luke API.
 * Registers Fastify's global error handler and exposes the tRPC error formatter.
 */

import type {
  FastifyInstance,
  FastifyError,
  FastifyRequest,
  FastifyReply,
} from 'fastify';
import { TRPCError } from '@trpc/server';
import { isProduction } from '@luke/core';

const isProd = isProduction();

/** Extracts a readable message from any caught value. */
export function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Extracts the trace ID from the `x-luke-trace-id` request header,
 * falling back to the Fastify-assigned request ID.
 */
export function getTraceId(req: FastifyRequest): string | undefined {
  const header = req.headers['x-luke-trace-id'];
  return (Array.isArray(header) ? header[0] : header) || (req as any).id;
}

function redactError(err: any): any {
  if (!err || typeof err !== 'object') return err;
  const clone: any = { ...err };
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

function mapHttpStatus(err: any): number {
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
  const status = (err?.statusCode as number) || 500;
  if (status >= 400 && status <= 599) return status;
  return 500;
}

function safeMessage(err: any): string {
  if (!isProd) return err?.message || 'Errore interno';
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

function toResponseBody(err: any, traceId?: string) {
  const base = {
    error: true,
    message: safeMessage(err),
    code: err instanceof TRPCError ? err.code : 'INTERNAL_SERVER_ERROR',
    traceId,
  } as Record<string, any>;
  if (!isProd) {
    base.stack = err?.stack;
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
 * tRPC error formatter compatible with `initTRPC.create({ errorFormatter })`.
 * Replaces internal error messages with a generic string in production.
 */
export const trpcErrorFormatter = ({ shape }: any) => {
  return {
    ...shape,
    message: isProd ? 'Internal server error' : shape.message,
  };
};
