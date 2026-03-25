import type { Logger } from 'pino';
import type mssql from 'mssql';

/** Risultato della valutazione del filtro di sync NAV. */
export type NavFilterResult =
  | { shouldSkip: true; filterMode: string }
  | {
      shouldSkip: false;
      filterMode: string;
      /** Predicati SQL da combinare in WHERE (senza la keyword WHERE). */
      filterPredicates: string[];
      bindParams: (req: mssql.Request) => void;
    };

/**
 * Valuta il NavSyncFilter e restituisce i predicati SQL pronti per il WHERE.
 *
 * Restituisce `filterPredicates` (array) anziché un `whereClause` già assemblato
 * per permettere al chiamante di aggiungere predicati extra (es. watermark differenziale).
 * Usa `buildWhereClause(predicates)` per assemblare il WHERE finale.
 *
 * Regole:
 * - active=false          → shouldSkip: true
 * - whitelist + navNos [] → shouldSkip: true (whitelist vuota = nessun record ammesso)
 * - whitelist + navNos    → predicato [codeField] IN (...)
 * - exclude  + navNos     → predicato [codeField] NOT IN (...)
 * - all (o nessun filtro) → nessun predicato
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
 * Assembla una WHERE clause SQL da un array di predicati.
 * Restituisce stringa vuota se l'array è vuoto.
 */
export function buildWhereClause(predicates: string[]): string {
  return predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '';
}

/**
 * Esegue `fn` su tutti i `rows` in batch paralleli di dimensione `batchSize`.
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
