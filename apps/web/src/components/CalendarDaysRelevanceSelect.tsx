'use client';

import { trpc } from '../lib/trpc';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

/** Sentinel for "no relevance" (null) — Radix Select can't represent an empty string value. */
export const NO_RELEVANCE_VALUE = '_none';

const OPTIONS = [
  { value: 'COMPANY', label: 'Calendario aziendale' },
  { value: 'VENDOR', label: 'Calendario fornitore' },
  { value: 'BOTH', label: 'Entrambi' },
] as const;

interface Props {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

/**
 * Picks which holiday calendar(s) count toward this event's working-days deadline countdown —
 * see docs/TASK_working_days_calendar_relevance.md. Defaults to "nessuna" (calendar days, current
 * behavior unchanged) — this is opt-in, not something every event needs to set.
 *
 * The resolved country is never a free-text field: COMPANY comes from the company profile
 * (shown here read-only), VENDOR is resolved per-row from each collection-layout row's assigned
 * vendor at compute time — an event applies to a whole planning group (many rows, potentially
 * many vendors), so there's no single "the" vendor country to show at the event level.
 */
export function CalendarDaysRelevanceSelect({ value, onValueChange, disabled }: Props) {
  const { data: company } = trpc.company.profile.get.useQuery(undefined, {
    enabled: value === 'COMPANY' || value === 'BOTH',
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-1">
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_RELEVANCE_VALUE}>— Nessuna (giorni di calendario) —</SelectItem>
          {OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {value === 'COMPANY' && (
        <p className="text-xs text-muted-foreground">
          Paese: {company?.countryCode ?? '— non impostato in Impostazioni azienda —'}
        </p>
      )}
      {value === 'VENDOR' && (
        <p className="text-xs text-muted-foreground">
          Risolto dal fornitore assegnato a ciascuna riga collezione.
        </p>
      )}
      {value === 'BOTH' && (
        <p className="text-xs text-muted-foreground">
          Giorno lavorativo solo se aperto sia in azienda ({company?.countryCode ?? '—'}) sia presso il fornitore di ciascuna riga.
        </p>
      )}
    </div>
  );
}
