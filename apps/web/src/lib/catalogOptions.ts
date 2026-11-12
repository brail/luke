/** A catalog item as a picker shows it. */
export interface CatalogOption {
  value: string;
  label: string;
}

/**
 * The options of a catalog picker for a field holding `held`: the active items, plus `held` itself,
 * marked, when it is a value no active item has — a deactivated item stays on the rows that hold it,
 * and a Select whose value matches no option shows nothing. While the items are still loading
 * (`undefined`), `held` is listed unmarked. An empty value (a new row) adds nothing.
 */
export function withHeldOption(options: CatalogOption[] | undefined, held: string | null | undefined): CatalogOption[] {
  const active = options ?? [];
  if (!held || active.some(o => o.value === held)) return active;
  return [...active, { value: held, label: options ? `${held} (non attiva)` : held }];
}
