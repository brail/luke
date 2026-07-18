'use client';

import { useAppContext } from '../../../../../contexts/AppContextProvider';
import { trpc } from '../../../../../lib/trpc';

/** Resolves the active brand/season's Collection Layout — shared by every tab/view in Controllo. */
export function useControlloLayout() {
  const { brand, season, isLoading: contextLoading } = useAppContext();
  const enabled = !!brand?.id && !!season?.id;

  const { data: layout } = trpc.collectionLayout.get.useQuery(
    { brandId: brand?.id ?? '', seasonId: season?.id ?? '' },
    { enabled }
  );

  return { layout, enabled, contextLoading };
}
