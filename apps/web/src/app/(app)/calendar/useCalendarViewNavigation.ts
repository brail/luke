'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState } from 'react';

import { type CalendarDate, parseCalendarDate } from '@luke/core';

import type { Route } from 'next';

const VALID_VIEWS = ['list', 'gantt', 'week', 'day', 'month'] as const;
type CalendarView = (typeof VALID_VIEWS)[number];

interface UseCalendarViewNavigationResult {
  view: CalendarView;
  /** The day the URL names (`?date=`), or `null` when it names none: the page then shows today. */
  viewDate: CalendarDate | null;
  /** Changes only the view, keeping the current date. Used by the view-switcher toolbar. */
  setView: (v: CalendarView) => void;
  /** Changes only the date, keeping the current view. */
  setViewDate: (d: CalendarDate) => void;
  /**
   * Changes view and date together in one navigation. Required whenever both change from the
   * same user action (e.g. clicking a day/week number) — calling `setView` and `setViewDate`
   * back to back would each build their `URLSearchParams` from the same pre-click snapshot, so
   * the second call's write would silently discard the first's.
   */
  setViewAndDate: (v: CalendarView, d: CalendarDate) => void;
}

/**
 * Owns `view`/`viewDate` state for the calendar page and keeps them mirrored into the URL
 * (`?view=&date=`), read back on mount so a shared link opens on the right view/day. `?date=` is a
 * calendar date, which no zone changes: it is read and written as the same `YYYY-MM-DD`.
 */
export function useCalendarViewNavigation(): UseCalendarViewNavigationResult {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [view, setViewState] = useState<CalendarView>(() => {
    const v = searchParams.get('view');
    return (VALID_VIEWS as readonly string[]).includes(v ?? '') ? (v as CalendarView) : 'month';
  });
  const [viewDate, setViewDateState] = useState<CalendarDate | null>(() => parseCalendarDate(searchParams.get('date') ?? ''));

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

  const setViewDate = useCallback((d: CalendarDate) => {
    setViewDateState(d);
    navigate({ date: d });
  }, [navigate]);

  const setViewAndDate = useCallback((v: CalendarView, d: CalendarDate) => {
    setViewState(v);
    setViewDateState(d);
    navigate({ view: v, date: d });
  }, [navigate]);

  return { view, viewDate, setView, setViewDate, setViewAndDate };
}
