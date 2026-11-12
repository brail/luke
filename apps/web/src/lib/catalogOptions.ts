import type { CollectionCatalogType } from '@luke/core';

/** A catalog item as a picker shows it. */
export interface CatalogOption {
  value: string;
  label: string;
}

/** A collection catalog item as `collectionCatalog.listAll` returns it (`type` is a plain string column). */
export interface CatalogItem extends CatalogOption {
  type: string;
  isActive: boolean;
}

/** The row fields a catalog backs, and the catalog type of each: `status` is the line status. */
export const ROW_CATALOG_TYPE = {
  productCategory: 'productCategory',
  strategy: 'strategy',
  status: 'lineStatus',
  styleStatus: 'styleStatus',
  pricePositioning: 'pricePositioning',
} as const satisfies Record<string, CollectionCatalogType>;

export type RowCatalogField = keyof typeof ROW_CATALOG_TYPE;

export const isRowCatalogField = (key: string): key is RowCatalogField => Object.hasOwn(ROW_CATALOG_TYPE, key);

/** The values present, in the given order first, then any other alphabetically. */
export function ordered(present: Iterable<string>, order: readonly string[]): string[] {
  const values = new Set(present);
  return [
    ...order.filter(v => values.has(v)),
    ...[...values].filter(v => !order.includes(v)).sort((a, b) => a.localeCompare(b)),
  ];
}

export interface Catalog {
  /** The active items of a type, what a picker offers; `undefined` while the catalog loads. */
  options: (type: CollectionCatalogType) => CatalogItem[] | undefined;
  /** Every item of a type, inactive ones too, in catalog order: what a filter offers. */
  all: (type: CollectionCatalogType) => CatalogItem[];
  /** The item's label, inactive items included; a value no item has (or a catalog still loading) shows as itself. */
  label: (type: CollectionCatalogType, value: string) => string;
  /** The values present, in catalog order, then the values no item has, alphabetically. */
  order: (type: CollectionCatalogType, present: Iterable<string>) => string[];
}

const NO_ITEMS: CatalogItem[] = [];

/** Lookups over the whole catalog (`items` in type then catalog order); `undefined` while it loads. */
export function catalogLabeler(items: readonly CatalogItem[] | undefined): Catalog {
  const byType = new Map<string, CatalogItem[]>();
  const active = new Map<string, CatalogItem[]>();
  const labels = new Map<string, Map<string, string>>();
  const push = (map: Map<string, CatalogItem[]>, item: CatalogItem) => {
    const list = map.get(item.type);
    if (list) list.push(item);
    else map.set(item.type, [item]);
  };
  for (const item of items ?? []) {
    push(byType, item);
    if (item.isActive) push(active, item);
    labels.set(item.type, (labels.get(item.type) ?? new Map()).set(item.value, item.label));
  }
  const all = (type: CollectionCatalogType) => byType.get(type) ?? NO_ITEMS;
  return {
    options: type => (items ? (active.get(type) ?? NO_ITEMS) : undefined),
    all,
    label: (type, value) => labels.get(type)?.get(value) ?? value,
    order: (type, present) => ordered(present, all(type).map(i => i.value)),
  };
}

/**
 * The options of a catalog picker for a field holding `held`: the active items, plus `held` itself,
 * under its own label and marked, when no active item has it — a deactivated item stays on the rows
 * that hold it, and a Select whose value matches no option shows nothing. While the catalog is still
 * loading, `held` is listed unmarked. An empty value (a new row) adds nothing.
 */
export function withHeldOption(catalog: Catalog, type: CollectionCatalogType, held: string | null | undefined): CatalogOption[] {
  const options = catalog.options(type);
  const active = options ?? NO_ITEMS;
  if (!held || active.some(o => o.value === held)) return active;
  const label = catalog.label(type, held);
  return [...active, { value: held, label: options ? `${label} (non attiva)` : label }];
}
