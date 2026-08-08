/**
 * No-op logger for tests.
 *
 * `{ info, warn, error, debug }` isn't enough: the `FastifyBaseLogger` type also
 * requires `child`, `level`, `fatal`, `trace`, and `silent`. Partial mocks have
 * already cost a false negative — a `ctx.logger?.warn(...)` on an empty object
 * threw a TypeError, masking an expected FORBIDDEN as INTERNAL_SERVER_ERROR.
 */

import type { Context } from '../../src/lib/trpc';

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
