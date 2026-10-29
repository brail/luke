/**
 * The API's one logger. Every module logs through a child of it (`rootLogger.child({ module })`) and
 * Fastify uses it as its instance, so the level, the development transport and the redaction apply
 * to every line. The `err` serializer keeps an error's message, stack and cause chain (pino's, with
 * each cause's message written once).
 */

import pino, { type LoggerOptions } from 'pino';

import { isDevelopment, isProduction } from '@luke/core';

import { logLineWithoutQueryArguments } from './queryArguments';

/**
 * Keys whose value never reaches a log line, up to two levels down (`smtp.auth.pass`) and two levels
 * inside a logged error (`err.config.auth.pass`): pino matches exact paths, with no recursive
 * wildcard, and the `err` serializer copies every enumerable property of the error. A value inside
 * a message or a stack is text, which no key can match.
 */
const REDACTED_KEYS = [
  'password',
  'pass',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'bindDN',
  'bindPassword',
  'authorization',
  'cookie',
  'credentials',
  'details',
] as const;

/** What pino reads as an error in a cause chain: anything with a string `message` (pino's own check, not exported). */
function isErrorLike(value: unknown): value is { message: string; cause?: unknown } {
  return typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string';
}

/**
 * The cause chain's message written once. A wrapper that ends with its cause's message and carries
 * the cause too (`Impossibile inviare email: <reason>`) does not get the reason again: pino's own
 * serializer appends every cause (`…: X: X`). Only an equal message or that exact ending counts —
 * never a substring, so a short cause such as `x` stays. A cycle ends with `: ...`, as pino marks it.
 * `null`: a VError-style function cause, left to pino.
 */
function messageOnce(err: { message: string; cause?: unknown }): string | null {
  let text = err.message;
  const seen = new Set<unknown>([err]);
  let parent = err;
  while (isErrorLike(parent.cause)) {
    const cause = parent.cause;
    if (seen.has(cause)) return `${text}: ...`;
    seen.add(cause);
    if (cause.message && cause.message !== parent.message && !parent.message.endsWith(`: ${cause.message}`)) {
      text += `: ${cause.message}`;
    }
    parent = cause;
  }
  return typeof parent.cause === 'function' ? null : text;
}

/**
 * pino's standard `err` serializer, with the top-level error's cause chain written once
 * (`messageOnce`). Errors nested in other properties or in `aggregateErrors` go through pino's own.
 */
function serializeError(err: unknown) {
  // pino hands a serializer any value; its own returns a non-error-like one unchanged.
  const serialized = pino.stdSerializers.err(err as Error);
  // Without a cause pino's message is already the error's own.
  const message = err instanceof Error && isErrorLike(err) && isErrorLike(err.cause) ? messageOnce(err) : null;
  if (message !== null) serialized.message = message;
  return serialized;
}

/** The root logger's options, exported so tests build their logger from the real configuration. */
export const loggerOptions: LoggerOptions = {
  // `||`, not `??`: an empty value (the compose files pass one when unset) makes pino throw.
  // nosemgrep: luke-no-direct-env -- LOG_LEVEL is observability bootstrap (CLAUDE.md Env Policy)
  level: process.env.LOG_LEVEL || (isProduction() ? 'warn' : 'info'),
  redact: REDACTED_KEYS.flatMap(key => [key, `*.${key}`, `*.*.${key}`, `err.*.*.${key}`]),
  serializers: { err: serializeError },
  // The last step before a line is written: the query values a Prisma error renders go, whatever key
  // or message carries them (`lib/queryArguments.ts`).
  hooks: { streamWrite: logLineWithoutQueryArguments },
  transport: isDevelopment()
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss Z', ignore: 'pid,hostname' },
      }
    : undefined,
};

export const rootLogger = pino(loggerOptions);

/** What `@luke/nav` logs through: its own default logger has neither this level nor the redaction. */
export const navLogger = rootLogger.child({ module: 'nav' });
