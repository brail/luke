'use client';

import { useMemo } from 'react';

import type { RouterOutputs } from '@luke/api';
import { formatPhaseLabel } from '@luke/core';

import { trpc } from '../../../../../lib/trpc';


export type Phase = RouterOutputs['phase']['list'][number];

/**
 * Fetches the active Phase catalog and derives the lookup shapes shared across
 * collection-layout components (row select, filter options, badge/order lookups).
 */
export function usePhaseCatalog() {
  const { data: phases = [] } = trpc.phase.list.useQuery(undefined, { staleTime: 5 * 60 * 1000 });

  const phaseById = useMemo(() => new Map(phases.map(p => [p.id, p])), [phases]);

  const phaseOptions = useMemo(
    () => phases.map(p => ({ value: p.id, label: formatPhaseLabel(p.code, p.label) })),
    [phases]
  );

  return { phases, phaseById, phaseOptions };
}
