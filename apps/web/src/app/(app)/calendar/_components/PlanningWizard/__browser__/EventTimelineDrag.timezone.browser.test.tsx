import { describe, expect, test } from 'vitest';
import { render } from 'vitest-browser-react';

import { EventTimelineDrag } from '../EventTimelineDrag';

import type { HolidayEntry, HolidayMap } from '../../useHolidays';

/**
 * Timezone-sensitive regression proof for `EventTimelineDrag`'s blocked-day lookup — runs under
 * Europe/Rome and America/Los_Angeles (see `vitest.browser.timezone.config.mts`).
 *
 * The bug: `anchorDate`/`value` come from a real event instant (`EventStep` passes `new
 * Date(event.startAt)`), not a timezone-less plain date, so the time-of-day it carries matters.
 * `toUtcIsoDate(value)` reads back which UTC calendar day that instant falls on — but the day
 * NUMBER actually shown to the user in the strip (`d.getDate()`) is a local getter. For an instant
 * late enough in the UTC day, the two disagree: in a positive-offset zone (Europe/Rome), an event
 * at 23:30 UTC on March 5 is already local March 6 — the UI shows "6" but the old code checked
 * `holidayDates`/`closedDates` (both keyed by the *held* date's own UTC-midnight encoding — see
 * `useHolidays.ts`) for "2026-03-05" instead of "2026-03-06", missing a holiday that actually
 * covers the visually displayed day. Fixed by `toLocalIsoDate`, matching what's displayed.
 *
 * This is inherently timezone-*asymmetric*, not just timezone-independent like the calendar-grid
 * fixes: the same instant genuinely lands on a different local calendar day in Rome (March 6) than
 * in Los Angeles (still March 5, since 23:30 UTC minus 8 hours doesn't cross midnight) — so the
 * *correct* (fixed) behavior itself differs per instance, and the test computes its expectation
 * from the actual local/UTC day split at runtime rather than hardcoding one outcome for both.
 */

const FIXTURE_HOLIDAY: HolidayEntry = { countryCode: 'FX', name: 'Fixture Holiday', nameEn: 'Fixture Holiday' };
const BLOCKED_BANNER_TEXT = 'Data su giorno festivo o chiusura fornitore';

describe(`EventTimelineDrag holiday lookup (${Intl.DateTimeFormat().resolvedOptions().timeZone})`, () => {
  test('an event instant late in the UTC day is checked against its LOCAL calendar day, not the UTC one', async () => {
    const eventInstant = new Date('2026-03-05T23:30:00.000Z');

    // A holiday keyed on the LOCAL day this instant falls on in whichever zone this instance is
    // running under — computed independently of the component under test (local getters here,
    // not a call into `toLocalIsoDate`), matching how a real HolidayMap key (the holiday's own
    // UTC-midnight-encoded date, see the file doc comment above) numerically equals the intended
    // 'YYYY-MM-DD'. Under Europe/Rome this is '2026-03-06' (local day 6, UTC day 5 — the two
    // disagree, which is what falsifies the bug); under America/Los_Angeles both agree at '05', so
    // this fixture can't tell fixed from buggy code in that direction — same asymmetry as the
    // month-view holiday fix, see this file's own doc comment.
    const localIso = `2026-03-${String(eventInstant.getDate()).padStart(2, '0')}`;
    const holidayDates: HolidayMap = new Map([[localIso, [FIXTURE_HOLIDAY]]]);

    const screen = await render(
      <EventTimelineDrag
        anchorDate={eventInstant}
        value={eventInstant}
        onChange={() => {}}
        holidayDates={holidayDates}
        closedDates={new Set()}
      />
    );

    await expect.element(screen.getByText(BLOCKED_BANNER_TEXT)).toBeInTheDocument();
  });
});
