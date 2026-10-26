/**
 * Loggers for tests: a no-op one (`createSilentLogger`) and one that captures the API's real JSON
 * lines (`captureLogger`).
 *
 * For the no-op one, `{ info, warn, error, debug }` isn't enough: the `FastifyBaseLogger` type also
 * requires `child`, `level`, `fatal`, `trace`, and `silent`. Partial mocks have
 * already cost a false negative — a `ctx.logger?.warn(...)` on an empty object
 * threw a TypeError, masking an expected FORBIDDEN as INTERNAL_SERVER_ERROR.
 */

import pino from 'pino';

import { loggerOptions } from '../../src/lib/logger';

import type { Context } from '../../src/lib/trpc';

/** The fields a test reads from a JSON log line. */
interface LogLine {
  msg?: string;
  err?: { message?: string; stack?: string };
  cause?: string;
}

/**
 * A pino logger with the API's own options (`loggerOptions`), writing its JSON lines where the test
 * can read them: what a real line carries, serializers and redaction included.
 */
export function captureLogger() {
  const lines: LogLine[] = [];
  const destination = { write: (line: string) => void lines.push(JSON.parse(line)) };
  // No transport: pino refuses one next to a destination stream, and development sets pino-pretty.
  return { logger: pino({ ...loggerOptions, transport: undefined, level: 'info' }, destination), lines };
}

export function createSilentLogger(): Context['logger'] {
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
    trace: () => {},
    silent: () => {},
    level: 'silent',
    child: () => logger,
  };

  return logger as unknown as Context['logger'];
}
