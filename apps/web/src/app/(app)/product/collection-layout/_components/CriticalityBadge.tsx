'use client';

import { Badge } from '../../../../../components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../../../components/ui/tooltip';
import { trpc } from '../../../../../lib/trpc';

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
 * this spells out the exact day count and deadline. Shared by `CriticalityBadge` (per-row query,
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

/** "5gg ritardo" (overdue, negative) / "scade oggi" (zero) / "tra 12gg" (days left, positive) —
 * same day count `formatCriticalityTooltip` spells out, condensed for inline display in the badge. */
export function formatDaysLabel(daysToDeadline: number): string {
  if (daysToDeadline < 0) return `${Math.abs(daysToDeadline)}gg ritardo`;
  if (daysToDeadline === 0) return 'scade oggi';
  return `tra ${daysToDeadline}gg`;
}

/**
 * Presentational band badge + tooltip — the outline/colored-by-band-hex rendering shared by
 * `CriticalityBadge` (per-row query) and `CollectionGroupSection`'s table cell (batched lookup).
 * Takes already-resolved data, no fetch of its own, so both call sites can keep their own
 * (deliberately different) data-fetching strategy. Purely presentational — deciding what the label
 * says (band only, or band + day count) is the caller's call, not this component's.
 *
 * @param label - Defaults to `band.label`. Pass a combined string (e.g. `` `${band.label} · tra 12gg` ``,
 *   via `formatDaysLabel`) when the caller wants the day count appended — the row-drawer header
 *   wants this, the table cell stays band-only.
 */
export function CriticalityBandBadge({ band, tooltip, className, label = band.label }: { band: CriticalityBand; tooltip: string; className?: string; label?: string }) {
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
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Shows the current alert-engine criticality band for a row, combined with the day count (days
 * overdue from the oldest uncompleted phase, or days left to the next phase-completion event) vs
 * configured thresholds. Renders nothing when the row has no active phase (calendar not set up, or
 * the row already reached its last applicable phase — no alert needed).
 */
export function CriticalityBadge({ rowId, className }: Props) {
  const { data } = trpc.phaseAlert.criticalityForRow.useQuery({ rowId }, { staleTime: 60 * 1000 });
  if (!data) return null;

  return (
    <CriticalityBandBadge
      band={data.band}
      tooltip={formatCriticalityTooltip(data)}
      className={className}
      label={`${data.band.label} · ${formatDaysLabel(data.daysToDeadline)}`}
    />
  );
}
