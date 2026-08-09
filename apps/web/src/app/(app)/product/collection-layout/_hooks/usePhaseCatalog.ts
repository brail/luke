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
 * Una sola query, due usi distinti:
 * - `phaseById` è costruita su **tutte** le fasi, incluse le ritirate: serve a risolvere le
 *   etichette dello storico. Una riga che ha attraversato una fase poi disattivata continua a
 *   referenziarla, e senza di essa mostrerebbe un trattino al posto di un dato che esiste.
 * - `phases` e `phaseOptions` restano filtrate sulle attive: sono ciò che si può *scegliere*
 *   (picker, filtro colonna) e la base su cui si scala il colore del badge.
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
