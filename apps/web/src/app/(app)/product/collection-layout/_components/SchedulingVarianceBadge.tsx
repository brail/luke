'use client';

import { Badge } from '../../../../../components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../../../components/ui/tooltip';
import { trpc } from '../../../../../lib/trpc';

/** Matches the plain `toLocaleDateString('it-IT')` convention used elsewhere in this feature. */
function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('it-IT');
}

interface Props {
  rowId: string;
  className?: string;
}

/**
 * Shows plan-vs-actual scheduling variance for a row's current phase: the frozen baseline date
 * (piano) vs when the row actually reached that phase (`CollectionRowPhaseHistory`). Distinct from
 * `CriticalityBadge` — that one is forward-looking (days to the *next* deadline), this one is a
 * historical accuracy check on the phase the row is *at now*. Renders nothing until the calendar
 * is frozen and the row has actually transitioned into its current phase at least once.
 */
export function SchedulingVarianceBadge({ rowId, className }: Props) {
  const { data } = trpc.phaseAlert.schedulingVarianceForRow.useQuery({ rowId }, { staleTime: 60 * 1000 });
  if (!data) return null;

  const { varianceDays, plannedDate, actualDate, daysMode } = data;
  const label = varianceDays === 0
    ? 'In linea col piano'
    : varianceDays > 0
      ? `+${varianceDays} gg vs piano`
      : `${varianceDays} gg vs piano`;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="secondary" className={className}>{label}</Badge>
        </TooltipTrigger>
        <TooltipContent>
          Pianificato: {formatDate(plannedDate)} — Raggiunto: {formatDate(actualDate)}
          {daysMode === 'working' && ' (gg lavorativi)'}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
