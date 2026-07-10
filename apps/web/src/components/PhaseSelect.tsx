'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

interface PhaseOption {
  id: string;
  label: string;
}

interface Props {
  value: string;
  onValueChange: (value: string) => void;
  phases: PhaseOption[];
  disabled?: boolean;
}

/** Sentinel used in place of `null` for "no phase" — Radix Select can't represent an empty string value. */
export const NO_PHASE_VALUE = '_none';

/** Phase dropdown with a "no phase" option — shared between calendar events and milestone templates. */
export function PhaseSelect({ value, onValueChange, phases, disabled }: Props) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_PHASE_VALUE}>— Nessuna (evento non di fase) —</SelectItem>
        {phases.map(p => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
