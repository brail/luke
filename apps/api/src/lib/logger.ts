/**
 * The API's one logger. Every module logs through a child of it (`rootLogger.child({ module })`) and
 * Fastify uses it as its instance, so the level, the development transport and the redaction apply
 * to every line. pino's standard `err` serializer keeps an error's message, stack and cause.
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

/** The root logger's options, exported so tests build their logger from the real configuration. */
export const loggerOptions: LoggerOptions = {
  // `||`, not `??`: an empty value (the compose files pass one when unset) makes pino throw.
  // nosemgrep: luke-no-direct-env -- LOG_LEVEL is observability bootstrap (CLAUDE.md Env Policy)
  level: process.env.LOG_LEVEL || (isProduction() ? 'warn' : 'info'),
  redact: REDACTED_KEYS.flatMap(key => [key, `*.${key}`, `*.*.${key}`, `err.*.*.${key}`]),
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
