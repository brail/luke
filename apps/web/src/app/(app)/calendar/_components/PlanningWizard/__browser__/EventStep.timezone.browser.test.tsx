import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import { type CalendarDate } from '@luke/core';

import { at, date, PROFILE, ZONE } from '../../../../../../lib/__browser__/zoneFixtures';
import { EventStep } from '../EventStep';

import type { CalendarEventItem } from '../../types';
import type { HolidayEntry, HolidayMap } from '../../useHolidays';

/**
 * The planning wizard's step under each zone of `vitest.browser.timezone.config.mts`. The strip,
 * the holiday/closure lookup and the value written back are all one calendar date; what can still
 * go wrong is turning the event into that date. An all-day event is its own date in every zone —
 * read from the instant with local getters it was the day before west of UTC, and the lookup
 * checked the wrong day. A timed event is the date of its instant in the reader's profile zone,
 * never the browser's.
 */

const FIXTURE_HOLIDAY: HolidayEntry = { countryCode: 'FX', name: 'Fixture Holiday', nameEn: 'Fixture Holiday' };
const BLOCKED_BANNER_TEXT = 'Data su giorno festivo o chiusura fornitore';

function event(startAt: string, allDay: boolean): CalendarEventItem {
  return { id: 'e1', title: 'Evento', startAt, endAt: null, allDay, publishExternally: false, visibilities: [], planningGroupId: 'g1' };
}

async function renderStep(ev: CalendarEventItem, draftDate: CalendarDate, holidayKey: string) {
  const holidayDates: HolidayMap = new Map([[holidayKey, [FIXTURE_HOLIDAY]]]);
  return render(
    <EventStep event={ev} zone={PROFILE} draftDate={draftDate} onDraftDateChange={() => {}} holidayDates={holidayDates} closedDates={new Set()} />,
  );
}

describe(`planning wizard step (browser ${ZONE}, profile ${PROFILE})`, () => {
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

  test('a timed event is placed on its profile date', async () => {
    // Half past midnight is the day before west of the profile zone, half past eleven the day after east of it.
    for (const time of ['00:30', '23:30']) {
      const screen = await renderStep(event(at('2026-03-05', time).toISOString(), false), date('2026-03-05'), '2026-03-05');
      await expect.element(screen.getByText(BLOCKED_BANNER_TEXT)).toBeInTheDocument();
      const cells = [...screen.container.querySelectorAll('span.tabular-nums')].map(s => s.textContent);
      expect(cells[9]).toBe('5');
      await screen.unmount();
    }
  });
});
