/**
 * Error handling e formatter centralizzati per Luke API
 */

import type {
  FastifyInstance,
  FastifyError,
  FastifyRequest,
  FastifyReply,
} from 'fastify';
import { TRPCError } from '@trpc/server';

const isProd = process.env.NODE_ENV === 'production';

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

// tRPC error formatter compatibile con initTRPC.create({ errorFormatter })
export const trpcErrorFormatter = ({ shape }: any) => {
  return {
    ...shape,
    message: isProd ? 'Internal server error' : shape.message,
  };
};


