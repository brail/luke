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
    utils.catalog.brands.invalidate();

    // Se brandId fornito, invalida anche query specifiche del brand
    if (brandId) {
      // Le query specifiche del brand saranno invalidate automaticamente
      // quando context.get viene invalidato, ma possiamo essere espliciti
      utils.catalog.brands.invalidate();
    }

    // TODO: Aggiungere qui future query context-aware
    // es: utils.products.list.invalidate({ brandId, seasonId })
    // es: utils.reports.generate.invalidate({ brandId, seasonId })
  };

  return invalidateContextQueries;
}
