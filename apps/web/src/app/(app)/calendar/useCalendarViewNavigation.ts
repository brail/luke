'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { calendarLinkTargetOf, parseCalendarDate, type CalendarDate, type CalendarLinkTarget } from '@luke/core';

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
  /** The notification link the URL carries, or `null`: read live, so a second link replaces the first. */
  linkTarget: CalendarLinkTarget | null;
  /**
   * Drops the link target from the URL and, given `date`, moves to that day, in one navigation: two
   * back-to-back replaces would each start from the same snapshot, and the second would undo the first.
   */
  clearLinkTarget: (date?: CalendarDate) => void;
}

/**
 * Owns `view`/`viewDate` state for the calendar page and keeps them mirrored into the URL
 * (`?view=&date=`), read back on mount so a shared link opens on the right view/day. `?date=` is a
 * calendar date, which no zone changes: it is read and written as the same `YYYY-MM-DD`. Also reads the
 * notification link target (`?event=`, `?calendar=`) that `CalendarLinkOpener` resolves and clears.
 */
export function useCalendarViewNavigation(): UseCalendarViewNavigationResult {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [view, setViewState] = useState<CalendarView>(() => {
    const v = searchParams.get('view');
    return (VALID_VIEWS as readonly string[]).includes(v ?? '') ? (v as CalendarView) : 'month';
  });
  const [viewDate, setViewDateState] = useState<CalendarDate | null>(() => parseCalendarDate(searchParams.get('date') ?? ''));

  /** Sets each key of `updates`, or deletes it when `null`. */
  const navigate = useCallback((updates: Record<string, string | null>) => {
    const p = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) p.delete(key);
      else p.set(key, value);
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

  const linkTarget = useMemo(() => calendarLinkTargetOf(searchParams), [searchParams]);

  // `view` and `date` too: a link followed from elsewhere replaced the URL, and they live on in state.
  const clearLinkTarget = useCallback((d?: CalendarDate) => {
    if (d) setViewDateState(d);
    // The names `calendarLink` writes.
    navigate({ event: null, calendar: null, view, date: d ?? viewDate });
  }, [navigate, view, viewDate]);

  return { view, viewDate, setView, setViewDate, setViewAndDate, linkTarget, clearLinkTarget };
}
