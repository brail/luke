import { trpc } from '../lib/trpc';

/**
 * Returns a function that invalidates all React Query caches that depend on
 * the active Brand/Season context: `context.get`, `brand.list`,
 * `catalog.brands`, and `catalog.seasons`.
 *
 * @returns `invalidateContextQueries()` — call after any mutation that
 *   changes the active context or the brand/season catalog.
 */
export function useInvalidateContext() {
  const utils = trpc.useUtils();

  /** Invalidates all context-aware query caches. */
  const invalidateContextQueries = () => {
    // The active context itself
    utils.context.get.invalidate();

    // The brand list, so the UI reflects the change
    utils.brand.list.invalidate();

    // The ContextSelector queries (the brand/season dropdowns in the navbar)
    utils.catalog.brands.invalidate();
    utils.catalog.seasons.invalidate(); // every cached variant (one per brandId)
  };

  return invalidateContextQueries;
}
