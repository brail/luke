import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { type CalendarDate } from '@luke/core';

import { date, ZONE } from '../../../../lib/__browser__/zoneFixtures';
import { useCalendarViewNavigation } from '../useCalendarViewNavigation';

import { paramsFromLastReplace } from './navigationTestHelpers';

/**
 * The calendar's `?date=` under every zone of `vitest.browser.timezone.config.mts`: a calendar date,
 * read and written as the same `YYYY-MM-DD`. It once went through a local-midnight `Date` and
 * `toISOString()` / `new Date('YYYY-MM-DD')`, which moved it by a day on one side of UTC or the other.
 *
 * Top-level `vi.mock` + mutable fakes, as in the sibling `useCalendarViewNavigation.browser.test.tsx`:
 * a dynamic import of the hook across tests would return the module bound to the first test's mock.
 */

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

async function mountNavigation(search: string): Promise<ReturnType<typeof useCalendarViewNavigation>> {
  setUrl(search);
  let nav!: ReturnType<typeof useCalendarViewNavigation>;
  function Harness() {
    nav = useCalendarViewNavigation();
    return null;
  }
  await render(<Harness />);
  return nav;
}

describe(`useCalendarViewNavigation keeps the URL's calendar date (${ZONE})`, () => {
  test('this instance runs off UTC', () => {
    // Guards the proof: at offset 0 a date moved through UTC would come back unchanged by accident.
    expect(new Date(2026, 2, 5).getTimezoneOffset()).not.toBe(0);
  });

  test('reads ?date= as that calendar date', async () => {
    expect((await mountNavigation('view=day&date=2026-03-05')).viewDate).toBe('2026-03-05');
  });

  test('writes a calendar date to ?date= unchanged', async () => {
    const nav = await mountNavigation('view=month&date=2026-01-01');
    fakeReplace.mockClear();
    nav.setViewAndDate('day', date('2026-03-05'));
    expect(paramsFromLastReplace(fakeReplace).get('date')).toBe('2026-03-05');
  });

  test('names no date without a valid ?date=: the page then shows today in the reader zone', async () => {
    for (const search of ['view=month', 'view=month&date=2026-02-30', 'view=month&date=05/03/2026']) {
      const viewDate: CalendarDate | null = (await mountNavigation(search)).viewDate;
      expect(viewDate).toBeNull();
    }
  });
});
