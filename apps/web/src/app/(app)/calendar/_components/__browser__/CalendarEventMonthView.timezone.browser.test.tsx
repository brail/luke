import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import { CalendarEventMonthView } from '../CalendarEventMonthView';

import type { HolidayEntry, HolidayMap } from '../useHolidays';

/**
 * Timezone-sensitive regression proof for the December 2026 month grid's holiday lookup — runs
 * under Europe/Rome and America/Los_Angeles (see `vitest.browser.timezone.config.mts`, the same
 * dedicated config `dateSerialization.timezone.browser.test.tsx` uses), never under the runner's
 * ambient default.
 *
 * The bug: `holidayDates?.get(day.toISOString().slice(0, 10))` converted the LOCAL calendar cell
 * `day` (built by `mondayOf`/`addDays`, both local-getter arithmetic — see `calendar/utils.ts`) to
 * UTC before looking it up in a `HolidayMap` keyed by `toUtcIsoDate` on the holiday's OWN date (see
 * `useHolidays.ts` — a plain calendar date with no attached timezone, correctly represented as UTC
 * midnight, whose UTC-ISO string numerically equals the intended 'YYYY-MM-DD'). In Europe/Rome
 * (positive UTC offset), the local-midnight December 25 cell converts to UTC December 24 — the
 * lookup misses '2026-12-25' entirely, and the cell for December 26 (whose local midnight converts
 * to UTC December 25) incorrectly picks up the holiday instead. Fixed by `toLocalIsoDate(day)`,
 * which reads `day` back with the same local getters it was built from.
 *
 * December 2026 was chosen because its 42-cell grid (Monday Nov 30 – Sunday Jan 10, verified
 * separately) contains exactly one cell showing "25" and exactly one showing "26", so the plain
 * `getByText` lookups below are unambiguous.
 */

function makeHolidayMap(dateKey: string, entry: HolidayEntry): HolidayMap {
  return new Map([[dateKey, [entry]]]);
}

const FIXTURE_HOLIDAY: HolidayEntry = { countryCode: 'FX', name: 'Fixture Holiday', nameEn: 'Fixture Holiday' };

describe(`CalendarEventMonthView holiday lookup (${Intl.DateTimeFormat().resolvedOptions().timeZone})`, () => {
  test('a holiday keyed on the 25th shades the December 25 cell, never December 26', async () => {
    const screen = await render(
      <CalendarEventMonthView
        milestones={[]}
        viewDate={new Date(2026, 11, 1)}
        onViewDateChange={() => {}}
        onEventClick={() => {}}
        onEventUpdate={() => {}}
        brandColorMap={{}}
        holidayDates={makeHolidayMap('2026-12-25', FIXTURE_HOLIDAY)}
      />
    );

    // The day-number span and any holiday-code badges are direct siblings under the same "day
    // header" row div (see CalendarEventMonthView's `mb-0.5 flex items-center ...` div) — reading
    // the day number's own parent is enough to tell whether ITS cell carries the holiday badge.
    const day25 = screen.getByText('25', { exact: true }).element();
    const day26 = screen.getByText('26', { exact: true }).element();

    expect(day25.parentElement?.textContent).toContain('FX');
    expect(day26.parentElement?.textContent ?? '').not.toContain('FX');
  });
});
