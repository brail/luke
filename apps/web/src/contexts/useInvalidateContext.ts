import { trpc } from '../lib/trpc';

/**
 * Hook per invalidare le query context-aware
 *
 * Fornisce una funzione centralizzata per invalidare tutte le query
 * che dipendono dal context (Brand/Season).
 *
 * @returns Funzione per invalidare le query context-aware
 */
export function useInvalidateContext() {
  const utils = trpc.useUtils();

  /**
   * Invalida tutte le query context-aware
   *
   * @param brandId - ID del brand modificato (opzionale)
   * Se fornito, invalida anche le query brand-specifiche
   */
  const invalidateContextQueries = (brandId?: string) => {
    // Invalida il context principale
    utils.context.get.invalidate();

    // Invalida lista brand per aggiornare UI
    utils.brand.list.invalidate();

    // TODO: Aggiungere qui future query context-aware
    // es: utils.products.list.invalidate({ brandId, seasonId })
    // es: utils.reports.generate.invalidate({ brandId, seasonId })
    void brandId; // parametro riservato per future query brand-specifiche
  };

  return invalidateContextQueries;
}
