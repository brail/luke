import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { useCalendarViewNavigation } from '../useCalendarViewNavigation';
import { parseLocalIsoDate, toLocalIsoDate } from '../utils';

import { paramsFromLastReplace } from './navigationTestHelpers';

/**
 * Timezone-sensitive regression proof — runs in a real Chromium under two different
 * `Intl.DateTimeFormat` zones (see `vitest.browser.timezone.config.mts`: Europe/Rome, a positive
 * UTC offset, and America/Los_Angeles, a negative one), never under the runner's default (often
 * UTC, where a local-vs-UTC date bug shows on neither direction and would pass unnoticed).
 *
 * The bug this guards against: the calendar's `?date=` URL param and `viewDate` state used to
 * round-trip through `Date.prototype.toISOString()` (UTC) on write and `new Date(dateOnlyString)`
 * (also UTC, per the ISO-8601 date-only grammar) on read, while every OTHER calendar date — the
 * `previous`/`next`/`today` controls, a day/week-number click's underlying cell — is a LOCAL
 * midnight `Date` built with local getters/setters (`calendar/utils.ts`'s `startOfDay`/`addDays`).
 * Converting a local midnight to UTC and back is not the identity function except at UTC+0:
 * a positive offset (Rome) makes `toISOString().slice(0, 10)` report the PREVIOUS calendar day;
 * a negative offset (Los Angeles) makes `new Date('YYYY-MM-DD')` construct the PREVIOUS calendar
 * day locally. `toLocalIsoDate`/`parseLocalIsoDate` (both in `calendar/utils.ts`) fix this by
 * using local getters/the local `Date(y, m, d)` constructor on both ends.
 */

function currentZoneOffsetMinutes(): number {
  return new Date(2026, 2, 5).getTimezoneOffset();
}

describe(`date serialization is timezone-safe (running under ${Intl.DateTimeFormat().resolvedOptions().timeZone})`, () => {
  test('this instance is actually running under a non-UTC offset', () => {
    // A guard on the proof itself: if this ever reports 0, the two instances above stopped
    // applying their `timezoneId`, and every other assertion in this file would be vacuous.
    expect(currentZoneOffsetMinutes()).not.toBe(0);
  });

  test('toLocalIsoDate/parseLocalIsoDate round-trip a local calendar day exactly, with no shift', () => {
    const localMidnight = new Date(2026, 2, 5); // local March 5, however this zone reads that instant in UTC
    const serialized = toLocalIsoDate(localMidnight);
    expect(serialized).toBe('2026-03-05');

    const parsedBack = parseLocalIsoDate(serialized);
    expect(parsedBack).not.toBeNull();
    expect(parsedBack!.getFullYear()).toBe(2026);
    expect(parsedBack!.getMonth()).toBe(2);
    expect(parsedBack!.getDate()).toBe(5);
  });

  test('parseLocalIsoDate does NOT reproduce the classic new Date("YYYY-MM-DD") off-by-one', () => {
    // `new Date('2026-03-05')` anchors to UTC midnight; in a negative-offset zone that instant's
    // LOCAL calendar day is March 4, not March 5 — the exact bug `parseLocalIsoDate` exists to
    // avoid. This assertion is only interesting in a negative-offset instance (Los Angeles); in a
    // positive-offset one (Rome) the native constructor happens not to shift, which is exactly
    // why testing under only one offset sign would have missed this.
    const viaNativeParse = new Date('2026-03-05');
    const viaLocalParse = parseLocalIsoDate('2026-03-05')!;
    if (currentZoneOffsetMinutes() > 0) {
      // Negative UTC offset zone (e.g. Los Angeles): getTimezoneOffset() > 0 by JS convention.
      expect(viaNativeParse.getDate()).toBe(4); // the bug, reproduced with the native constructor
    }
    expect(viaLocalParse.getDate()).toBe(5); // the fix: always the day that was actually written
  });

  test('a local-midnight Date does NOT reproduce the classic toISOString().slice(0,10) off-by-one', () => {
    // Round-tripping a LOCAL midnight through toISOString() converts to UTC first; in a
    // positive-offset zone (Rome), that lands on the PREVIOUS UTC day — the exact bug
    // `toLocalIsoDate` exists to avoid. Only interesting in a positive-offset instance.
    const localMidnight = new Date(2026, 2, 5);
    const viaNativeFormat = localMidnight.toISOString().slice(0, 10);
    const viaLocalFormat = toLocalIsoDate(localMidnight);
    if (currentZoneOffsetMinutes() < 0) {
      // Positive UTC offset zone (e.g. Rome): getTimezoneOffset() < 0 by JS convention.
      expect(viaNativeFormat).toBe('2026-03-04'); // the bug, reproduced with the native method
    }
    expect(viaLocalFormat).toBe('2026-03-05'); // the fix: always the day that was actually clicked
  });
});

// ─── Same proof, exercised through the real production hook ───────────────────────────────────
//
// Uses a top-level `vi.mock` + mutable fakes (the same pattern as the sibling
// `useCalendarViewNavigation.browser.test.tsx`), not `vi.doMock` + dynamic `import()`: a dynamic
// import of the same specifier across two tests in one file returns the module registry's CACHED
// instance, still bound to the first test's mock — the second test's hook silently exercised the
// wrong `fakeReplace` and its assertion failed with an opaque "undefined is not iterable" instead
// of a real explanation. A statically-imported hook re-rendered against a reset mock has no such
// cache to go stale.

const { fakeGet, fakeToString, fakeReplace } = vi.hoisted(() => ({
  fakeGet: vi.fn<(key: string) => string | null>(),
  fakeToString: vi.fn<() => string>(),
  fakeReplace: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: fakeGet, toString: fakeToString }),
  useRouter: () => ({ replace: fakeReplace }),
}));

function setUrl(search: string) {
  const params = new URLSearchParams(search);
  fakeGet.mockImplementation((key: string) => params.get(key));
  fakeToString.mockImplementation(() => params.toString());
}

describe(`useCalendarViewNavigation reads/writes the local calendar day (${Intl.DateTimeFormat().resolvedOptions().timeZone})`, () => {
  test('reads ?date=2026-03-05 as local March 5, not shifted by a day', async () => {
    setUrl('view=day&date=2026-03-05');

    let viewDate!: Date;
    function Harness() {
      const nav = useCalendarViewNavigation();
      viewDate = nav.viewDate;
      return null;
    }
    await render(<Harness />);

    expect(viewDate.getFullYear()).toBe(2026);
    expect(viewDate.getMonth()).toBe(2);
    expect(viewDate.getDate()).toBe(5);
  });

  test('a local-midnight target Date is written to the URL as the same local calendar day', async () => {
    setUrl('view=month&date=2026-01-01');
    fakeReplace.mockClear();

    let setViewAndDate!: (v: 'day', d: Date) => void;
    function Harness() {
      const nav = useCalendarViewNavigation();
      setViewAndDate = nav.setViewAndDate;
      return null;
    }
    await render(<Harness />);

    // Simulates a day/week-number click's `day.toISOString()` -> `new Date(isoDate)` round trip:
    // a LOCAL midnight Date, serialized to a full UTC instant and parsed back, is exactly what
    // handleDayNumberClick hands to setViewAndDate.
    const clickedLocalDay = new Date(2026, 2, 5);
    const asClickPayload = clickedLocalDay.toISOString();
    const reconstructed = new Date(asClickPayload);

    setViewAndDate('day', reconstructed);

    const written = paramsFromLastReplace(fakeReplace);
    expect(written.get('date')).toBe('2026-03-05');
  });
});
