'use client';

import type { RouterOutputs } from '@luke/api';
import { formatDate } from '@luke/core';

import { Badge } from '../../../../../components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../../../components/ui/tooltip';
import { bandBadgeStyle } from '../../../../../lib/alertBandStyle';
import { trpc } from '../../../../../lib/trpc';
import { cn } from '../../../../../lib/utils';

import type { Phase } from '../_hooks/usePhaseCatalog';

interface Props {
  rowId: string;
  className?: string;
}

/** Payload del motore di alert, derivato dal server invece che riscritto a mano: se un campo
 * cambia nome lato API il build cade qui, dove va corretto, invece di silenziosamente al runtime.
 * `criticalityForLayout` ritorna la stessa union arricchita di `productCategory`, quindi entrambe
 * le strategie di fetch (per riga e batch) soddisfano questi tipi. */
type RowCriticality = NonNullable<RouterOutputs['phaseAlert']['criticalityForRow']>;
type CriticalityInfo = Extract<RowCriticality, { state: 'active' }>;
type CompletionInfo = Extract<RowCriticality, { state: 'completed' }>;
type CriticalityBand = RowCriticality['band'];

/**
 * "gg lavorativi (IT+CN)" / "gg di calendario" — l'unità che ogni tooltip di questa feature deve
 * enunciare allo stesso modo: mostrare "gg" per entrambi i modi sarebbe ingannevolmente preciso
 * su cosa si sta davvero contando (vedi `calendarDaysRelevance`, e
 * docs/TASK_working_days_calendar_relevance.md).
 */
function daysUnitLabel(daysMode: 'calendar' | 'working', relevantCountryCodes: string[]): string {
  if (daysMode !== 'working') return 'gg di calendario';
  return `gg lavorativi${relevantCountryCodes.length > 0 ? ` (${relevantCountryCodes.join('+')})` : ''}`;
}

/**
 * Tooltip text for a criticality badge — the band label alone ("Urgente") doesn't say how urgent;
 * this spells out the exact day count and deadline. Shared by `CriticalitySituation` (per-row query,
 * used in the row drawer) and the table's batched lookup in `CollectionGroupSection` — same payload
 * either way, only the fetch strategy differs.
 */
export function formatCriticalityTooltip({ daysToDeadline, deadline, eventTitle, daysMode, relevantCountryCodes }: CriticalityInfo): string {
  // `formatDate` di @luke/core (solo giorno, locale it-IT) — non quella di `lib/config-helpers`,
  // costruita per i timestamp di audit e con un'ora del giorno che qui non serve.
  const dateLabel = formatDate(new Date(deadline));
  const unitLabel = daysUnitLabel(daysMode, relevantCountryCodes);
  if (daysToDeadline < 0) return `In ritardo di ${Math.abs(daysToDeadline)} ${unitLabel} — «${eventTitle}»: ${dateLabel}`;
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
 * which case the tooltip states just the date, with no delta invented.
 */
export function formatCompletionTooltip({ completedAt, daysVsDeadline, deadline, eventTitle, daysMode, relevantCountryCodes }: CompletionInfo): string {
  const completedLabel = formatDate(new Date(completedAt));
  if (daysVsDeadline === null || deadline === null) {
    return `Conclusa il ${completedLabel} — nessuna milestone di riferimento`;
  }
  const dateLabel = formatDate(new Date(deadline));
  const unitLabel = daysUnitLabel(daysMode, relevantCountryCodes);
  const delta = daysVsDeadline === 0
    ? 'nel giorno della scadenza'
    : daysVsDeadline > 0
      ? `${daysVsDeadline} ${unitLabel} di anticipo`
      : `${Math.abs(daysVsDeadline)} ${unitLabel} di ritardo`;
  return `Conclusa il ${completedLabel}, ${delta} su «${eventTitle}»: ${dateLabel}`;
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
    <TooltipProvider>
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
