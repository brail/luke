/**
 * Logger no-op per i test.
 *
 * `{ info, warn, error, debug }` non basta: il tipo `FastifyBaseLogger` richiede
 * anche `child`, `level`, `fatal`, `trace` e `silent`. Mock parziali sono già
 * costati un falso negativo — un `ctx.logger?.warn(...)` su un oggetto vuoto
 * lanciava TypeError, mascherando un FORBIDDEN atteso in INTERNAL_SERVER_ERROR.
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
