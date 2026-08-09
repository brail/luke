'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

import type { ComponentPropsWithoutRef } from 'react';

interface PlanningGroupOption {
  id: string;
  name: string;
  isDefault: boolean;
}

/** "Name" or "Name (predefinito)" for the default group — shared label format across pickers/lists. */
export function formatPlanningGroupLabel(group: Pick<PlanningGroupOption, 'name' | 'isDefault'>): string {
  return group.isDefault ? `${group.name} (predefinito)` : group.name;
}

interface OwnProps {
  value: string;
  onValueChange: (value: string) => void;
  groups: PlanningGroupOption[];
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
}

// Extra props (id, aria-describedby, aria-invalid, ...) forwarded to the trigger — lets shadcn's
// `<FormControl>` (which clones those onto its single child via Radix Slot) wire this up like any
// other form field, without the caller needing to know they land on the trigger specifically.
type Props = OwnProps & Omit<ComponentPropsWithoutRef<typeof SelectTrigger>, keyof OwnProps | 'children'>;

/** Dropdown to pick a planning group, labeling the default one — shared across calendar and collection-layout dialogs. */
export function PlanningGroupSelect({ value, onValueChange, groups, disabled, loading, placeholder = 'Seleziona gruppo', ...triggerProps }: Props) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled ?? loading}>
      <SelectTrigger {...triggerProps}>
        <SelectValue placeholder={loading ? 'Caricamento…' : placeholder} />
      </SelectTrigger>
      <SelectContent>
        {groups.map(g => (
          <SelectItem key={g.id} value={g.id}>
            {formatPlanningGroupLabel(g)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
