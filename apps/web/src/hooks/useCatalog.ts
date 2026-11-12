'use client';

import { useMemo } from 'react';

import { catalogLabeler, type Catalog } from '../lib/catalogOptions';
import { trpc } from '../lib/trpc';

/**
 * The collection catalog, every type in one read, inactive items included (#245): what pickers offer,
 * what filters offer, and the label of any stored value. The functions are stable while the data is,
 * so they can sit in memo and effect dependencies. The admin page's `collectionCatalog` invalidation
 * refreshes it.
 */
export function useCatalog(): Catalog & { isPending: boolean; isError: boolean } {
  const { data, isPending, isError } = trpc.collectionCatalog.listAll.useQuery({}, { staleTime: 5 * 60 * 1000 });
  const catalog = useMemo(() => catalogLabeler(data), [data]);
  return { ...catalog, isPending, isError };
}
