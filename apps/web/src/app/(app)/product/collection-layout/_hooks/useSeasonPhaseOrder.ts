'use client';

import { useCallback, useMemo } from 'react';

import { trpc } from '../../../../../lib/trpc';

import { usePhaseCatalog } from './usePhaseCatalog';

/**
 * A layout's phases in season order (#159, `phaseAlert.seasonPhaseOrder`), for the views that span
 * its planning groups: the phases its calendar plans by their earliest deadline, then the other
 * active phases alphabetically. `rank` places any phase id — a retired phase no live event plans
 * sorts last —; `phases` and `phaseOptions` are the active catalog in that order.
 */
export function useSeasonPhaseOrder(collectionLayoutId: string | undefined) {
  const { phases, phaseOptions } = usePhaseCatalog();
  const { data: order } = trpc.phaseAlert.seasonPhaseOrder.useQuery(
    { collectionLayoutId: collectionLayoutId ?? '' },
    { enabled: !!collectionLayoutId, staleTime: 60 * 1000 },
  );

  const ranks = useMemo(() => new Map((order ?? []).map((phaseId, index) => [phaseId, index])), [order]);
  const rank = useCallback((phaseId: string) => ranks.get(phaseId) ?? Number.MAX_SAFE_INTEGER, [ranks]);

  return useMemo(() => ({
    rank,
    phases: [...phases].sort((a, b) => rank(a.id) - rank(b.id)),
    phaseOptions: [...phaseOptions].sort((a, b) => rank(a.value) - rank(b.value)),
  }), [rank, phases, phaseOptions]);
}
