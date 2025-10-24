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
   * Per ora invalida solo context.get, ma può essere esteso
   * con future query che dipendono dal context.
   */
  const invalidateContextQueries = () => {
    // Invalida il context principale
    utils.context.get.invalidate();

    // TODO: Aggiungere qui future query context-aware
    // es: utils.products.list.invalidate({ brandId, seasonId })
    // es: utils.reports.generate.invalidate({ brandId, seasonId })
  };

  return invalidateContextQueries;
}
