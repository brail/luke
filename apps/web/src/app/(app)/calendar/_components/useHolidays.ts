'use client';

import { useMemo } from 'react';

import { addDays, daysBetween } from '@luke/core';

import { trpc } from '../../../../lib/trpc';
import { toUtcIsoDate } from '../utils';

/** A single holiday entry stored in the HolidayMap for a given ISO date key. */
export interface HolidayEntry {
  countryCode: string;
  name: string;
  nameEn: string | null;
}

/** Map from UTC ISO date string ('YYYY-MM-DD') to the holidays falling on that day. */
export type HolidayMap = Map<string, HolidayEntry[]>;

/**
 * Fetches holidays for the given country codes and expands multi-day ranges into
 * a `HolidayMap` keyed by UTC ISO date string.
 *
 * @param countryCodes - ISO 3166-1 alpha-2 codes to fetch; query is skipped when empty.
 */
export function useHolidays(countryCodes: string[]): HolidayMap {
  const { data = [] } = trpc.holidays.listHolidays.useQuery(
    { countryCodes },
    { enabled: countryCodes.length > 0, staleTime: 30 * 60 * 1000 },
  );

  return useMemo(() => {
    const map = new Map<string, HolidayEntry[]>();
    for (const h of data) {
      const start = new Date(h.startDate);
      const end = new Date(h.endDate);
      const days = daysBetween(start, end);
      for (let i = 0; i <= days; i++) {
        const d = addDays(start, i);
        const iso = toUtcIsoDate(d);
        const entry: HolidayEntry = { countryCode: h.countryCode, name: h.name, nameEn: (h as any).nameEn ?? null };
        const existing = map.get(iso);
        if (existing) existing.push(entry);
        else map.set(iso, [entry]);
      }
    }
    return map;
  }, [data]);
}
