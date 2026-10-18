import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import { parseCalendarDate } from '@luke/core';

import { CalendarEventMonthView } from '../CalendarEventMonthView';

import type { HolidayEntry, HolidayMap } from '../useHolidays';

/**
 * The December 2026 month grid's holiday lookup, under every zone of
 * `vitest.browser.timezone.config.mts`. The grid's cells and the `HolidayMap` keys are both
 * calendar dates; a cell once built at local midnight and looked up by its UTC date
 * (`day.toISOString().slice(0, 10)`) found the 25th's holiday on the 26th in Rome.
 *
 * December 2026 was chosen because its 42-cell grid (Monday Nov 30 – Sunday Jan 10) contains
 * exactly one cell showing "25" and exactly one showing "26", so the plain `getByText` lookups
 * below are unambiguous.
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
        viewDate={parseCalendarDate('2026-12-01')!}
        zone={Intl.DateTimeFormat().resolvedOptions().timeZone}
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
