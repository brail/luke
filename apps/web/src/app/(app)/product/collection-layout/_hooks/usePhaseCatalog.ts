'use client';

import { useMemo } from 'react';

import type { RouterOutputs } from '@luke/api';
import { formatPhaseLabel } from '@luke/core';

import { trpc } from '../../../../../lib/trpc';


export type Phase = RouterOutputs['phase']['list'][number];

/**
 * Fetches the Phase catalog and derives the lookup shapes shared across collection-layout
 * components (row select, filter options, badge/order lookups).
 *
 * One query, two distinct uses:
 * - `phaseById` is built over **all** phases, retired ones included: it resolves the history
 *   labels. A row that went through a phase later deactivated still references it, and without it
 *   would show a dash in place of data that exists.
 * - `phases` and `phaseOptions` stay filtered to active ones: they are what can be *chosen*
 *   (picker, column filter) and the basis the badge colour scales on.
 */
export function usePhaseCatalog() {
  const { data: allPhases = [] } = trpc.phase.list.useQuery(
    { includeInactive: true },
    { staleTime: 5 * 60 * 1000 }
  );

  const phaseById = useMemo(() => new Map(allPhases.map(p => [p.id, p])), [allPhases]);

  const phases = useMemo(() => allPhases.filter(p => p.isActive), [allPhases]);

  const phaseOptions = useMemo(
    () => phases.map(p => ({ value: p.id, label: formatPhaseLabel(p.code, p.label) })),
    [phases]
  );

  return { phases, phaseById, phaseOptions };
}
