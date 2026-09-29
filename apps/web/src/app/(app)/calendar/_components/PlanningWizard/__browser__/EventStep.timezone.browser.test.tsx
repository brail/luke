import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import { parseCalendarDate, type CalendarDate } from '@luke/core';

import { EventStep } from '../EventStep';

import type { CalendarEventItem } from '../../types';
import type { HolidayEntry, HolidayMap } from '../../useHolidays';

/**
 * The planning wizard's step under each zone of `vitest.browser.timezone.config.mts`. The strip,
 * the holiday/closure lookup and the value written back are all one calendar date; what can still
 * go wrong is turning the event into that date. An all-day event is its own date in every zone —
 * read from the instant with local getters it was the day before west of UTC, and the lookup
 * checked the wrong day. A timed event is the local date of its instant: 23:30 UTC on March 5 is
 * already March 6 in Rome and still March 5 in Los Angeles.
 */

const FIXTURE_HOLIDAY: HolidayEntry = { countryCode: 'FX', name: 'Fixture Holiday', nameEn: 'Fixture Holiday' };
const BLOCKED_BANNER_TEXT = 'Data su giorno festivo o chiusura fornitore';

function event(startAt: string, allDay: boolean): CalendarEventItem {
  return { id: 'e1', title: 'Evento', startAt, endAt: null, allDay, publishExternally: false, visibilities: [], planningGroupId: 'g1' };
}

function date(s: string): CalendarDate {
  const parsed = parseCalendarDate(s);
  if (!parsed) throw new Error(`bad fixture date ${s}`);
  return parsed;
}

async function renderStep(ev: CalendarEventItem, draftDate: CalendarDate, holidayKey: string) {
  const holidayDates: HolidayMap = new Map([[holidayKey, [FIXTURE_HOLIDAY]]]);
  return render(
    <EventStep event={ev} draftDate={draftDate} onDraftDateChange={() => {}} holidayDates={holidayDates} closedDates={new Set()} />,
  );
}

describe(`planning wizard step (${Intl.DateTimeFormat().resolvedOptions().timeZone})`, () => {
  test('an all-day event sits on its own date: heading, strip marker and holiday lookup', async () => {
    const screen = await renderStep(event('2026-03-06T00:00:00.000Z', true), date('2026-03-06'), '2026-03-06');
    await expect.element(screen.getByText(BLOCKED_BANNER_TEXT)).toBeInTheDocument();
    await expect.element(screen.getByText('venerdì 6 marzo')).toBeInTheDocument();
    // The strip is centred on the date EventStep derives from the event, and the marker for the
    // draft sits on that same middle cell: the event and the draft agree on the date.
    const cells = [...screen.container.querySelectorAll('span.tabular-nums')].map(s => s.textContent);
    expect(cells[9]).toBe('6');
    expect(screen.getByRole('button', { name: 'Sposta evento' }).element().style.left).toBe(`${9 * 32}px`);
  });

  test('a timed event late in the UTC day is placed on its local date', async () => {
    const instant = new Date('2026-03-05T23:30:00.000Z');
    // The local date, computed here with local getters rather than by the code under test.
    const local = `2026-03-${String(instant.getDate()).padStart(2, '0')}`;
    const screen = await renderStep(event(instant.toISOString(), false), date(local), local);
    await expect.element(screen.getByText(BLOCKED_BANNER_TEXT)).toBeInTheDocument();
    const cells = [...screen.container.querySelectorAll('span.tabular-nums')].map(s => s.textContent);
    expect(cells[9]).toBe(String(instant.getDate()));
  });
});
