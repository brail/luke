'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

import type { ComponentPropsWithoutRef } from 'react';

interface PhaseOption {
  id: string;
  label: string;
}

interface OwnProps {
  value: string;
  onValueChange: (value: string) => void;
  phases: PhaseOption[];
  disabled?: boolean;
  /** Label for the "no phase" option — defaults to the calendar-event wording; pass a different
   * one for consumers where "evento" doesn't fit (e.g. a Collection Layout row isn't an event). */
  noneLabel?: string;
}

// Extra props (id, aria-describedby, aria-invalid, ...) forwarded to the trigger — lets shadcn's
// `<FormControl>` (which clones those onto its single child via Radix Slot) wire this up like any
// other form field, matching the same pattern in `PlanningGroupSelect`.
type Props = OwnProps & Omit<ComponentPropsWithoutRef<typeof SelectTrigger>, keyof OwnProps | 'children'>;

/** Sentinel used in place of `null` for "no phase" — Radix Select can't represent an empty string value. */
export const NO_PHASE_VALUE = '_none';

/** Phase dropdown with a "no phase" option — shared between calendar events, milestone templates, and collection-layout rows. */
export function PhaseSelect({ value, onValueChange, phases, disabled, noneLabel = '— Nessuna (evento non di fase) —', ...triggerProps }: Props) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger {...triggerProps}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_PHASE_VALUE}>{noneLabel}</SelectItem>
        {phases.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
