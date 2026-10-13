'use client';

import { useMemo, type Ref } from 'react';

import { sameTimeZone } from '@luke/core';

import { TIMEZONES, type TimezoneOption } from '../lib/i18n/timezones';
import { cn } from '../lib/utils';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

interface TimeZoneSelectProps {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  /** The zone saved before any edit: shown and kept even when the list does not offer it. */
  stored: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  onBlur?: () => void;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * `zone` among `options`: an alias of a listed zone takes that entry's place under its own spelling
 * (so `Asia/Calcutta` is not listed twice), an unlisted zone is added first, as it is.
 */
function withZone(options: TimezoneOption[], zone: string): TimezoneOption[] {
  if (!zone) return options;
  const listed = options.findIndex(option => sameTimeZone(option.value, zone));
  if (listed === -1) return [{ value: zone, label: zone }, ...options];
  return options.map((option, i) => (i === listed ? { ...option, value: zone } : option));
}

/**
 * The zones a person can pick from `TIMEZONES`. The saved zone and the current choice are always
 * among the options, so a zone the list does not offer (written by the browser-zone dialog or the
 * raw configuration page) is shown and kept rather than displayed as another one.
 */
export function TimeZoneSelect({ id, value, onValueChange, stored, disabled, invalid, describedBy, onBlur, ref }: TimeZoneSelectProps) {
  const options = useMemo(() => withZone(withZone(TIMEZONES, stored), value), [stored, value]);
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        ref={ref}
        id={id}
        onBlur={onBlur}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={cn(invalid && 'border-destructive')}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(option => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
