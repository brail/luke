import type mssql from 'mssql';
import type { Logger } from 'pino';

/**
 * Result of evaluating a `NavSyncFilter` record.
 * When `shouldSkip` is `true` the caller must return early without querying NAV.
 * When `false`, the caller receives SQL predicates and a bind-param helper
 * to compose the WHERE clause.
 */
export type NavFilterResult =
  | { shouldSkip: true; filterMode: string }
  | {
      shouldSkip: false;
      filterMode: string;
      /** SQL predicates to combine in the WHERE clause (without the `WHERE` keyword). */
      filterPredicates: string[];
      bindParams: (req: mssql.Request) => void;
    };

/**
 * Evaluates a `NavSyncFilter` record and returns SQL predicates ready to
 * be embedded in a WHERE clause.
 *
 * Returns an array of predicates (not an assembled WHERE string) so that callers
 * can append additional predicates (e.g. a differential watermark) before calling
 * `buildWhereClause()`.
 *
 * Skip rules:
 * - `active=false`              → `shouldSkip: true`
 * - `whitelist` with empty list → `shouldSkip: true` (empty whitelist admits no rows)
 * - `whitelist` with entries    → `[codeField] IN (...)`
 * - `exclude`  with entries     → `[codeField] NOT IN (...)`
 * - `all` or no filter record   → no predicates (full table)
 *
 * @param filter - Filter record from the database, or `null` if not configured
 * @param entity - Entity name used in log messages
 * @param codeField - NAV column name used for IN/NOT IN filtering (default: `'No_'`)
 */
export function buildNavSyncFilter(
  filter: { mode: string; navNos: string[]; active: boolean } | null,
  logger: Logger,
  entity: string,
  codeField: string = 'No_',
): NavFilterResult {
  if (!filter) {
    logger.info({ entity }, 'NAV sync: nessun criterio configurato, skip');
    return { shouldSkip: true, filterMode: 'not_configured' };
  }

  if (!filter.active) {
    logger.info({ entity, filter: 'disabled' }, 'NAV sync: entità disabilitata, skip');
    return { shouldSkip: true, filterMode: 'disabled' };
  }

  const filterMode = filter.mode;
  const navNos = filter.navNos;

  if (filterMode === 'whitelist' && navNos.length === 0) {
    logger.warn({ entity, filterMode }, 'NAV sync: whitelist con navNos vuoti — skip completo');
    return { shouldSkip: true, filterMode };
  }

  const filterPredicates: string[] = [];
  let bindParams: (req: mssql.Request) => void = () => {};

  if (filterMode === 'whitelist' && navNos.length > 0) {
    const placeholders = navNos.map((_, i) => `@wl${i}`).join(', ');
    filterPredicates.push(`[${codeField}] IN (${placeholders})`);
    bindParams = (req) => navNos.forEach((no, i) => req.input(`wl${i}`, no));
  } else if (filterMode === 'exclude' && navNos.length > 0) {
    const placeholders = navNos.map((_, i) => `@ex${i}`).join(', ');
    filterPredicates.push(`[${codeField}] NOT IN (${placeholders})`);
    bindParams = (req) => navNos.forEach((no, i) => req.input(`ex${i}`, no));
  }

  return { shouldSkip: false, filterMode, filterPredicates, bindParams };
}

/**
 * Assembles a SQL WHERE clause from an array of predicate strings.
 * Returns an empty string when the array is empty (no filtering).
 */
export function buildWhereClause(predicates: string[]): string {
  return predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '';
}

/**
 * Creates an mssql request with an explicit timeout instead of the driver default,
 * since NAV sync queries scan large tables in chunked loops.
 */
export function createSyncRequest(pool: mssql.ConnectionPool, timeoutMs = 60_000): mssql.Request {
  const request = pool.request();
  // mssql type definitions don't expose `timeout` but it's a valid runtime property

  (request as any).timeout = timeoutMs;
  return request;
}

/**
 * Binds an array of values as named parameters (`@{prefix}0, @{prefix}1, …`) on an
 * mssql request and returns the comma-separated placeholder list for an IN clause.
 * Owns the index/placeholder alignment so callers can't drift out of sync.
 */
export function bindInClause(
  req: mssql.Request,
  prefix: string,
  values: readonly string[],
  sqlType?: mssql.ISqlType | (() => mssql.ISqlType),
): string {
  values.forEach((v, i) => {
    if (sqlType) req.input(`${prefix}${i}`, sqlType, v);
    else req.input(`${prefix}${i}`, v);
  });
  return values.map((_, i) => `@${prefix}${i}`).join(', ');
}

/**
 * Processes all `rows` by executing `fn` on each one, in parallel batches of `batchSize`.
 * Rows within a batch run concurrently; the next batch starts only after the current
 * batch resolves.
 */
export async function processInBatches<T>(
  rows: T[],
  batchSize: number,
  fn: (row: T) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    await Promise.all(rows.slice(i, i + batchSize).map(fn));
  }
}
