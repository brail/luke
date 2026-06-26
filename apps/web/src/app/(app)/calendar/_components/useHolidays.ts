'use client';

import { useMemo } from 'react';

import { addDays, daysBetween } from '@luke/core';

import { trpc } from '../../../../lib/trpc';
import { toUtcIsoDate } from '../utils';

export interface HolidayEntry {
  countryCode: string;
  name: string;
  nameEn: string | null;
}

export type HolidayMap = Map<string, HolidayEntry[]>;

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
