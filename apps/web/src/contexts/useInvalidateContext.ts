import { trpc } from '../lib/trpc';

/**
 * Returns a function that invalidates all React Query caches that depend on
 * the active Brand/Season context: `context.get`, `brand.list`,
 * `catalog.brands`, and `catalog.seasons`.
 *
 * @returns `invalidateContextQueries(brandId?)` — call after any mutation that
 *   changes the active context or the brand/season catalog.
 */
export function useInvalidateContext() {
  const utils = trpc.useUtils();

  /**
   * Invalidates all context-aware query caches.
   *
   * @param brandId - Reserved for future brand-scoped query invalidations.
   */
  const invalidateContextQueries = (brandId?: string) => {
    // Invalida il context principale
    utils.context.get.invalidate();

    // Invalida lista brand per aggiornare UI
    utils.brand.list.invalidate();

    // Invalida le query del ContextSelector (tendine di selezione nella navbar)
    utils.catalog.brands.invalidate();
    utils.catalog.seasons.invalidate(); // invalida tutte le varianti cached (per ogni brandId)

    // TODO: Aggiungere qui future query context-aware
    // es: utils.products.list.invalidate({ brandId, seasonId })
    // es: utils.reports.generate.invalidate({ brandId, seasonId })
    void brandId; // parametro riservato per future query brand-specifiche
  };

  return invalidateContextQueries;
}
