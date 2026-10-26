/**
 * Centralised error handling and response formatting for Luke API.
 * Registers Fastify's global error handler and exposes the tRPC error formatter.
 */

import { TRPCError } from '@trpc/server';
import { ZodError } from 'zod';

import { isProduction } from '@luke/core';
import { Prisma } from '@luke/db';

import { withoutQueryArguments } from './queryArguments';
import { isRateLimitExceededCause } from './rateLimitError';

import type { Context } from './context';
import type { TRPCDefaultErrorShape, TRPCErrorFormatter } from '@trpc/server';
import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyError,
  FastifyRequest,
  FastifyReply,
} from 'fastify';

const isProd = isProduction();

/**
 * Extracts a readable message from any caught value. An empty `message` falls back to what else the
 * error carries: Node's dual-stack connect failure is an `AggregateError` whose own message is
 * empty, with the real reasons in `errors` (#49). A thrown primitive is its own text and a plain
 * object gives its string `message`, never `[object Object]`; nothing at all is `Unknown error`. A
 * Prisma error keeps its call and reason, without the query values (`withoutQueryArguments`).
 */
export function toErrorMessage(err: unknown): string {
  return withoutQueryArguments(readMessage(err));
}

function readMessage(err: unknown): string {
  if (err === undefined || err === null) return 'Unknown error';
  if (typeof err !== 'object') return String(err) || 'Unknown error';
  if ('message' in err && typeof err.message === 'string' && err.message) return err.message;
  if (err instanceof AggregateError && err.errors.length > 0) return err.errors.map(readMessage).join('; ');
  if (!(err instanceof Error)) return 'Unknown error';
  return 'code' in err && typeof err.code === 'string' ? `${err.name}: ${err.code}` : err.name;
}

/** Extracts a stable error code for audit logging: tRPC code, Prisma error code, or 'UNKNOWN'. */
export function toErrorCode(err: unknown): string {
  if (err instanceof TRPCError) return err.code;
  if (err instanceof Prisma.PrismaClientKnownRequestError) return err.code;
  return 'UNKNOWN';
}

/**
 * Whether `err` is the Prisma refusal `code` on one of `constraints`. With the PostgreSQL driver
 * adapter the constraint is reported under `meta.driverAdapterError.cause.constraint.index`, not the
 * legacy `meta.target` (`constraintViolation.integration.spec.ts` reads it from a real refusal).
 */
function violates(err: unknown, code: string, constraints: readonly string[]): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== code) return false;
  // `meta` is typed as an open record.
  const adapterError = err.meta?.driverAdapterError as { cause?: { constraint?: { index?: string } } } | undefined;
  const constraint = adapterError?.cause?.constraint?.index;
  return constraint !== undefined && constraints.includes(constraint);
}

/**
 * `true` when `err` is Prisma's foreign-key violation (P2003) on one of the named constraints — and
 * only on those, so a failure on another relation keeps its own answer.
 */
export function isForeignKeyViolation(err: unknown, ...constraints: [string, ...string[]]): boolean {
  return violates(err, 'P2003', constraints);
}

/**
 * `true` when `err` is Prisma's unique violation (P2002) on one of the named constraints — and only
 * on those, so a duplicate on another key keeps its own answer instead of reading as these.
 */
export function isUniqueViolation(err: unknown, ...constraints: [string, ...string[]]): boolean {
  return violates(err, 'P2002', constraints);
}

/**
 * Extracts the trace ID from the `x-luke-trace-id` request header,
 * falling back to the Fastify-assigned request ID.
 */
export function getTraceId(req: FastifyRequest): string | undefined {
  const header = req.headers['x-luke-trace-id'];
  return (Array.isArray(header) ? header[0] : header) || req.id;
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
  if (!isProd) return toErrorMessage(err);
  // In production, do not expose back-end messages
  if (err instanceof TRPCError) {
    // Keep the user-facing message of known errors
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
 * Registers the global Fastify error handler. Maps tRPC and HTTP errors to status codes, logs the
 * failure once through the root logger (`lib/logger.ts`) — its `err` serializer keeps message, stack
 * and cause, its `redact` drops credentials — and keeps the stack out of production responses.
 */
export function setGlobalErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(
    (err: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
      const traceId = getTraceId(req);
      const status = mapHttpStatus(err);
      req.log.error({ err, traceId, method: req.method, url: req.url, ip: req.ip }, 'request failed');
      if (reply.sent) return;
      reply
        .code(status)
        .type('application/json')
        .send(toResponseBody(err, traceId));
    }
  );
}

/**
 * Logs a failed tRPC call once. An `INTERNAL_SERVER_ERROR` is a fault to diagnose: the error goes
 * whole, so the root logger's serializer keeps its stack and its cause chain — many carry a `cause`
 * precisely so the real failure reaches this line. Any other code is an answer — a 4xx the caller
 * earned, or an expected 5xx such as maintenance's `SERVICE_UNAVAILABLE` on every call: its code
 * and message under the same `err` key, without a stack.
 */
export function logTrpcError(
  log: FastifyBaseLogger,
  { path, error, traceId }: { path?: string; error: TRPCError; traceId?: string }
): void {
  if (error.code === 'INTERNAL_SERVER_ERROR') {
    // tRPC wraps an exception no procedure caught in an error with its message and stack: the
    // wrapper would print both twice, so the exception itself goes.
    log.error({ path, err: error.cause?.message === error.message ? error.cause : error, traceId }, 'tRPC error');
    return;
  }
  // A cause is worth a field only when it says more than the message: tRPC copies a Zod cause's
  // text into the message, and wraps a rate limit's `{ retryAfterSeconds }` in a cause with none.
  const cause = error.cause?.message && error.cause.message !== error.message ? error.cause.message : undefined;
  log.error({ path, err: { code: error.code, message: error.message }, cause, traceId }, 'tRPC error');
}

/**
 * One issue of a failed input parse. `path` is the full dotted path (`data.retailMultiplier`), not
 * its first segment: most mutations nest their fields, so `z.flattenError`'s first-segment
 * grouping filed every issue under `data`. `''` for an issue on the input itself.
 */
export interface ZodIssueData {
  path: string;
  message: string;
}

/**
 * Error shape returned to tRPC clients: `TRPCDefaultErrorShape` plus, on `data`:
 * - `retryAfterSeconds`, populated for rate-limit errors (not every `TOO_MANY_REQUESTS`) so
 *   clients can render an upper-bound `Retry-After` (the whole window) without recomputing it;
 * - `zodIssues`, for a 4xx whose cause is a `ZodError`: the message keeps only the first issue,
 *   and this keeps every issue with the field it belongs to.
 */
export interface LukeErrorShape extends TRPCDefaultErrorShape {
  data: TRPCDefaultErrorShape['data'] & { retryAfterSeconds?: number; zodIssues?: ZodIssueData[] };
}

/**
 * A 4xx is the caller's to fix, and its message is written for them, so it passes in every
 * environment. A 5xx can carry internals (driver errors, hosts, paths), so production replaces
 * it; the original still reaches the `tRPC error` log line (`logTrpcError`).
 * A failed input parse carries `ZodError`'s JSON dump of every issue as its message; the first
 * issue's own message replaces it, which is what a form bound to the same schema would show.
 */
function clientMessage(shape: TRPCDefaultErrorShape, error: TRPCError): string {
  if (shape.data.httpStatus >= 500) return isProd ? 'Internal server error' : shape.message;
  if (error.cause instanceof ZodError && error.message === error.cause.message) {
    return error.cause.issues[0]?.message ?? shape.message;
  }
  return shape.message;
}

/**
 * tRPC error formatter compatible with `initTRPC.create({ errorFormatter })`.
 * Decides which message reaches the client (see `clientMessage`) and surfaces
 * `retryAfterSeconds` for rate-limit errors (see `rateLimitError.ts`).
 */
export const trpcErrorFormatter: TRPCErrorFormatter<Context, LukeErrorShape> = ({ shape, error }) => {
  const retryAfterSeconds = isRateLimitExceededCause(error.cause)
    ? error.cause.retryAfterSeconds
    : undefined;
  // A 4xx only: an output that breaks its schema is a 500 with a ZodError cause too, and its
  // paths describe the server's schema, not anything the caller sent.
  const zodIssues: ZodIssueData[] | undefined =
    shape.data.httpStatus < 500 && error.cause instanceof ZodError
      ? error.cause.issues.map(issue => ({ path: issue.path.map(String).join('.'), message: issue.message }))
      : undefined;

  return {
    ...shape,
    message: clientMessage(shape, error),
    data: {
      ...shape.data,
      ...(retryAfterSeconds !== undefined && { retryAfterSeconds }),
      ...(zodIssues !== undefined && { zodIssues }),
    },
  };
};
