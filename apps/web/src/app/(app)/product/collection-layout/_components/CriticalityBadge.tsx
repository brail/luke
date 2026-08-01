'use client';

import { Badge } from '../../../../../components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../../../components/ui/tooltip';
import { trpc } from '../../../../../lib/trpc';
import { cn } from '../../../../../lib/utils';

import type { Phase } from '../_hooks/usePhaseCatalog';

interface Props {
  rowId: string;
  className?: string;
}

interface CriticalityInfo {
  daysToDeadline: number;
  deadline: string | Date;
  eventTitle: string;
  daysMode: 'calendar' | 'working';
  relevantCountryCodes: string[];
}

interface CriticalityBand {
  color: string;
  label: string;
}

/**
 * Tooltip text for a criticality badge — the band label alone ("Urgente") doesn't say how urgent;
 * this spells out the exact day count and deadline. Shared by `CriticalitySituation` (per-row query,
 * used in the row drawer) and the table's batched lookup in `CollectionGroupSection` — same
 * `{ daysToDeadline, deadline, eventTitle, daysMode, relevantCountryCodes }` shape either way,
 * only the fetch strategy differs.
 *
 * `daysMode` distinguishes plain calendar days (default) from working days (only when the active
 * event opted into `calendarDaysRelevance` — see docs/TASK_working_days_calendar_relevance.md) —
 * showing "gg" for both would be misleadingly precise about what's actually being counted.
 */
export function formatCriticalityTooltip({ daysToDeadline, deadline, eventTitle, daysMode, relevantCountryCodes }: CriticalityInfo): string {
  // Matches the plain `toLocaleDateString('it-IT')` convention used elsewhere in the calendar
  // feature (e.g. FreezePlanningGroupWizard) — not `lib/config-helpers`' formatDate, which is
  // built for config audit timestamps and adds a time-of-day component this doesn't need.
  const dateLabel = new Date(deadline).toLocaleDateString('it-IT');
  const unitLabel = daysMode === 'working'
    ? `gg lavorativi${relevantCountryCodes.length > 0 ? ` (${relevantCountryCodes.join('+')})` : ''}`
    : 'gg di calendario';
  if (daysToDeadline < 0) return `In ritardo di ${Math.abs(daysToDeadline)} ${unitLabel} — «${eventTitle}»: ${dateLabel}`;
  if (daysToDeadline === 0) return `Scade oggi — «${eventTitle}»: ${dateLabel}`;
  return `${daysToDeadline} ${unitLabel} alla scadenza — «${eventTitle}»: ${dateLabel}`;
}

/** "5 giorni di ritardo" (overdue, negative) / "scade oggi" (zero) / "tra 12 giorni" (days left,
 * positive) — same day count `formatCriticalityTooltip` spells out, spelled out in full for the
 * "Situazione" detail line (not the abbreviated "gg" form — that reads fine in a dense tooltip,
 * not as a standalone sentence). */
export function formatDaysLabel(daysToDeadline: number): string {
  if (daysToDeadline < 0) {
    const days = Math.abs(daysToDeadline);
    return `${days} ${days === 1 ? 'giorno' : 'giorni'} di ritardo`;
  }
  if (daysToDeadline === 0) return 'scade oggi';
  return `tra ${daysToDeadline} ${daysToDeadline === 1 ? 'giorno' : 'giorni'}`;
}

/**
 * Presentational band badge + tooltip — the outline/colored-by-band-hex rendering shared by
 * `CriticalitySituation` (per-row query) and `CollectionGroupSection`'s table cell (batched lookup).
 * Takes already-resolved data, no fetch of its own, so both call sites can keep their own
 * (deliberately different) data-fetching strategy. Band-only label — the day-count detail is a
 * separate line next to the badge, not baked into it (see `CriticalitySituation`).
 */
export function CriticalityBandBadge({ band, tooltip, className }: { band: CriticalityBand; tooltip: string; className?: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Color is an admin-configured hex value from AppConfig (collectionControl.alertThresholds),
              not a design token — cannot be expressed as a static Tailwind/CVA class. */}
          <Badge
            variant="outline"
            className={className}
            style={{ color: band.color, borderColor: band.color }}
          >
            {band.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * "Situazione" block for the row-drawer planning header: the alert-engine band on its own (no day
 * count baked into the badge — that reads as a snapshot, not a countdown), followed inline by a
 * detail that depends on where the row stands: days overdue if the active phase's deadline has
 * passed, otherwise the next phase and how long until its own deadline (when there is one). Renders
 * nothing when the row has no active phase (calendar not set up, or the row already reached its
 * last applicable phase — no alert needed).
 *
 * @param phaseById - Row-drawer's already-fetched phase catalog lookup (`usePhaseCatalog().phaseById`)
 *   — reused here to resolve the next phase's label without a second fetch.
 */
export function CriticalitySituation({ rowId, phaseById, className }: Props & { phaseById: Map<string, Phase> }) {
  const { data } = trpc.phaseAlert.criticalityForRow.useQuery({ rowId }, { staleTime: 60 * 1000 });
  if (!data) return null;

  const isLate = data.daysToDeadline < 0;
  const nextPhaseLabel = data.nextPhase ? phaseById.get(data.nextPhase.phaseId ?? '')?.label ?? '—' : null;

  return (
    <div className={cn('flex items-center gap-1.5 text-xs', className)}>
      <CriticalityBandBadge band={data.band} tooltip={formatCriticalityTooltip(data)} />
      {isLate && (
        <span className="text-muted-foreground">{formatDaysLabel(data.daysToDeadline)}</span>
      )}
      {!isLate && data.nextPhase && (
        <span className="text-muted-foreground">
          Prossima fase: {nextPhaseLabel} · {formatDaysLabel(data.nextPhase.daysUntil)}
        </span>
      )}
    </div>
  );
}
