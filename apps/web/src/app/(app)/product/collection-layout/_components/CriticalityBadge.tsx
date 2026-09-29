'use client';

import type { RouterOutputs } from '@luke/api';
import { formatCalendarDate, formatDate } from '@luke/core';

import { Badge } from '../../../../../components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../../../components/ui/tooltip';
import { bandBadgeStyle } from '../../../../../lib/alertBandStyle';
import { trpc } from '../../../../../lib/trpc';
import { cn } from '../../../../../lib/utils';

import type { Phase } from '../_hooks/usePhaseCatalog';

interface Props {
  rowId: string;
  className?: string;
}

/** Alert engine payload, derived from the server instead of rewritten by hand: if a field is
 * renamed API-side the build breaks here, where it needs fixing, instead of silently at runtime.
 * `criticalityForLayout` returns the same union enriched with `productCategory`, so both fetch
 * strategies (per row and batch) satisfy these types. */
type RowCriticality = NonNullable<RouterOutputs['phaseAlert']['criticalityForRow']>;
type CriticalityInfo = Extract<RowCriticality, { state: 'active' }>;
type CompletionInfo = Extract<RowCriticality, { state: 'completed' }>;
type CriticalityBand = RowCriticality['band'];

/**
 * "gg lavorativi (IT+CN)" / "gg di calendario" — the unit every tooltip of this feature must state
 * the same way: showing "gg" for both modes would be misleadingly precise about what is actually
 * being counted (see `calendarDaysRelevance` and docs/country-aware-working-days.md).
 */
function daysUnitLabel(daysMode: 'calendar' | 'working', relevantCountryCodes: string[]): string {
  if (daysMode !== 'working') return 'gg di calendario';
  return `gg lavorativi${relevantCountryCodes.length > 0 ? ` (${relevantCountryCodes.join('+')})` : ''}`;
}

/** `formatDate`'s day-only `dd/mm/yyyy`, for a calendar date. */
const DAY_ONLY = { year: 'numeric', month: '2-digit', day: '2-digit' } as const;

/**
 * Tooltip text for a criticality badge — the band label alone ("Urgente") doesn't say how urgent;
 * this spells out the exact day count and deadline. Shared by `CriticalitySituation` (per-row query,
 * used in the row drawer) and the table's batched lookup in `CollectionGroupSection` — same payload
 * either way, only the fetch strategy differs.
 */
export function formatCriticalityTooltip({ daysToDeadline, reached, deadlineDay, eventTitle, daysMode, relevantCountryCodes }: Pick<CriticalityInfo, 'daysToDeadline' | 'reached' | 'deadlineDay' | 'eventTitle' | 'daysMode' | 'relevantCountryCodes'>): string {
  // The day the count runs to, as the server names it in the business zone — formatting the
  // instant here would show a different day to a viewer in another zone.
  const dateLabel = formatCalendarDate(deadlineDay, DAY_ONLY);
  const unitLabel = daysUnitLabel(daysMode, relevantCountryCodes);
  if (daysToDeadline < 0) return `In ritardo di ${Math.abs(daysToDeadline)} ${unitLabel} — «${eventTitle}»: ${dateLabel}`;
  // Reached with a count of 0 (a timed deadline passed today, a weekend one seen on Monday in
  // working days): late, with no day of delay to state.
  if (reached) return `Scaduta — «${eventTitle}»: ${dateLabel}`;
  if (daysToDeadline === 0) return `Scade oggi — «${eventTitle}»: ${dateLabel}`;
  return `${daysToDeadline} ${unitLabel} alla scadenza — «${eventTitle}»: ${dateLabel}`;
}

/**
 * Tooltip for a concluded row: when it was closed and how that landed against the last planned
 * milestone. No countdown — a concluded row has stopped moving, the only thing left to say is
 * whether it made it.
 *
 * `daysVsDeadline` follows the same sign convention as `daysToDeadline` (positive = ahead of the
 * deadline), and is `null` when the row's planning group has no milestone to measure against — in
 * which case the tooltip states just the date, with no delta invented. `late` decides a count of 0:
 * completed after a timed deadline on its own day is past it, not "on the day".
 */
export function formatCompletionTooltip({ completedAt, daysVsDeadline, late, deadlineDay, eventTitle, daysMode, relevantCountryCodes }: Pick<CompletionInfo, 'completedAt' | 'daysVsDeadline' | 'late' | 'deadlineDay' | 'eventTitle' | 'daysMode' | 'relevantCountryCodes'>): string {
  const completedLabel = formatDate(new Date(completedAt));
  if (daysVsDeadline === null || deadlineDay === null) {
    return `Conclusa il ${completedLabel} — nessuna milestone di riferimento`;
  }
  const dateLabel = formatCalendarDate(deadlineDay, DAY_ONLY);
  const unitLabel = daysUnitLabel(daysMode, relevantCountryCodes);
  const delta = daysVsDeadline === 0
    ? late ? 'oltre la scadenza' : 'nel giorno della scadenza'
    : daysVsDeadline > 0
      ? `${daysVsDeadline} ${unitLabel} di anticipo`
      : `${Math.abs(daysVsDeadline)} ${unitLabel} di ritardo`;
  return `Conclusa il ${completedLabel}, ${delta} su «${eventTitle}»: ${dateLabel}`;
}

/** "5 giorni di ritardo" (overdue, negative) / "scaduta" (reached, zero) / "scade oggi" (zero) /
 * "tra 12 giorni" (days left, positive) — same day count `formatCriticalityTooltip` spells out,
 * spelled out in full for the "Situazione" detail line (not the abbreviated "gg" form — that reads
 * fine in a dense tooltip, not as a standalone sentence). */
export function formatDaysLabel(daysToDeadline: number, reached: boolean): string {
  if (daysToDeadline < 0) {
    const days = Math.abs(daysToDeadline);
    return `${days} ${days === 1 ? 'giorno' : 'giorni'} di ritardo`;
  }
  if (reached) return 'scaduta';
  if (daysToDeadline === 0) return 'scade oggi';
  return `tra ${daysToDeadline} ${daysToDeadline === 1 ? 'giorno' : 'giorni'}`;
}

/**
 * Presentational band badge + tooltip — the colored-by-band-hex rendering shared by
 * `CriticalitySituation` (per-row query) and `CollectionGroupSection`'s table cell (batched lookup).
 * Takes already-resolved data, no fetch of its own, so both call sites can keep their own
 * (deliberately different) data-fetching strategy. Band-only label — the day-count detail is a
 * separate line next to the badge, not baked into it (see `CriticalitySituation`).
 *
 * Visual weight follows the band's configured `emphasis`, so an admin can rank severity beyond what
 * hue alone conveys (a solid fill reads as more severe than the same hue in outline).
 */
export function CriticalityBandBadge({ band, tooltip, className }: { band: CriticalityBand; tooltip: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Color is an admin-configured hex value from AppConfig (collectionControl.alertThresholds),
            not a design token — cannot be expressed as a static Tailwind/CVA class. */}
        <Badge variant="outline" className={className} style={bandBadgeStyle(band)}>
          {band.label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
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
 * A concluded row shows its frozen outcome instead: no countdown and no next phase, because there
 * is no next move to make.
 *
 * @param phaseById - Row-drawer's already-fetched phase catalog lookup (`usePhaseCatalog().phaseById`)
 *   — reused here to resolve the next phase's label without a second fetch.
 */
export function CriticalitySituation({ rowId, phaseById, className }: Props & { phaseById: Map<string, Phase> }) {
  const { data } = trpc.phaseAlert.criticalityForRow.useQuery({ rowId }, { staleTime: 60 * 1000 });
  if (!data) return null;

  if (data.state === 'completed') {
    return (
      <div className={cn('flex items-center gap-1.5 text-xs', className)}>
        <CriticalityBandBadge band={data.band} tooltip={formatCompletionTooltip(data)} />
        <span className="text-muted-foreground">
          Conclusa il {formatDate(new Date(data.completedAt))}
        </span>
      </div>
    );
  }

  const isLate = data.reached;
  const nextPhaseLabel = data.nextPhase ? phaseById.get(data.nextPhase.phaseId ?? '')?.label ?? '—' : null;

  return (
    <div className={cn('flex items-center gap-1.5 text-xs', className)}>
      <CriticalityBandBadge band={data.band} tooltip={formatCriticalityTooltip(data)} />
      {isLate && (
        <span className="text-muted-foreground">{formatDaysLabel(data.daysToDeadline, data.reached)}</span>
      )}
      {!isLate && data.nextPhase && (
        <span className="text-muted-foreground">
          Prossima fase: {nextPhaseLabel} · {formatDaysLabel(data.nextPhase.daysUntil, data.nextPhase.reached)}
        </span>
      )}
    </div>
  );
}
