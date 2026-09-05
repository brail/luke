'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

import { parseLocalIsoDate, toLocalIsoDate } from './utils';

import type { Route } from 'next';

const VALID_VIEWS = ['list', 'gantt', 'week', 'day', 'month'] as const;
type CalendarView = (typeof VALID_VIEWS)[number];

interface UseCalendarViewNavigationResult {
  view: CalendarView;
  viewDate: Date;
  /** Changes only the view, keeping the current date. Used by the view-switcher toolbar. */
  setView: (v: CalendarView) => void;
  /** Changes only the date, keeping the current view. */
  setViewDate: (d: Date) => void;
  /**
   * Changes view and date together in one navigation. Required whenever both change from the
   * same user action (e.g. clicking a day/week number) — calling `setView` and `setViewDate`
   * back to back would each build their `URLSearchParams` from the same pre-click snapshot, so
   * the second call's write would silently discard the first's.
   */
  setViewAndDate: (v: CalendarView, d: Date) => void;
}

/**
 * Owns `view`/`viewDate` state for the calendar page and keeps them mirrored into the URL
 * (`?view=&date=`), read back on mount so a shared link opens on the right view/day.
 *
 * The `?date=` value is always the LOCAL calendar day the user is looking at — read with
 * `parseLocalIsoDate` and written with `toLocalIsoDate`, never `new Date(string)` /
 * `date.toISOString()`. Both of those go through UTC: parsing a date-only string anchors it to
 * UTC midnight (wrong local day in any negative-offset zone), and formatting a Date back through
 * UTC first can shift which calendar day it reports, depending on offset sign and time-of-day.
 *
 * The invariant this hook keeps is *not* "`viewDate` is always local midnight" — it isn't: the
 * initial-mount fallback (`new Date()`, when `?date=` isn't present yet) carries the real
 * current time-of-day, and nothing here stops a caller of `setViewDate`/`setViewAndDate` from
 * passing a `Date` with any time-of-day at all. The actual invariant is that `viewDate` is always
 * *serialized* through LOCAL date components — `toLocalIsoDate`'s `getFullYear()`/`getMonth()`/
 * `getDate()` — which identifies the calendar day a `Date` falls on locally regardless of what
 * time-of-day it carries. That's what makes the UTC round-trip bug avoidable without also having
 * to normalize every `Date` that reaches this hook to midnight first.
 */
export function useCalendarViewNavigation(): UseCalendarViewNavigationResult {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [view, setViewState] = useState<CalendarView>(() => {
    const v = searchParams.get('view');
    return (VALID_VIEWS as readonly string[]).includes(v ?? '') ? (v as CalendarView) : 'month';
  });
  const [viewDate, setViewDateState] = useState<Date>(() => {
    const d = searchParams.get('date');
    return (d && parseLocalIsoDate(d)) || new Date();
  });

  const navigate = useCallback((updates: Record<string, string>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      p.set(key, value);
    }
    // Valid at runtime (a query string on the current page) but not a statically known route, so
    // `typedRoutes` needs the same `as Route` escape hatch used elsewhere for computed paths.
    router.replace(`?${p.toString()}` as Route, { scroll: false });
  }, [router, searchParams]);

  const setView = useCallback((v: CalendarView) => {
    setViewState(v);
    navigate({ view: v });
  }, [navigate]);

  const setViewDate = useCallback((d: Date) => {
    setViewDateState(d);
    navigate({ date: toLocalIsoDate(d) });
  }, [navigate]);

  const setViewAndDate = useCallback((v: CalendarView, d: Date) => {
    setViewState(v);
    setViewDateState(d);
    navigate({ view: v, date: toLocalIsoDate(d) });
  }, [navigate]);

  return { view, viewDate, setView, setViewDate, setViewAndDate };
}
