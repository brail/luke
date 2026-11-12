'use client';

import type { CollectionCatalogType } from '@luke/core';

import { trpc } from '../../../../../lib/trpc';

const CATALOG_QUERY = { staleTime: 5 * 60 * 1000 };

/** The active items of a catalog type, what a picker offers; `undefined` while they load. */
export function useCatalogOptions(type: CollectionCatalogType) {
  return trpc.collectionCatalog.list.useQuery({ type }, CATALOG_QUERY).data;
}

/** Every item of a catalog type, inactive ones too, since rows may still hold them: what a filter offers. */
export function useAllCatalogOptions(type: CollectionCatalogType) {
  return trpc.collectionCatalog.listAll.useQuery({ type }, CATALOG_QUERY).data ?? [];
}
