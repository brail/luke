import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { useCalendarViewNavigation } from '../useCalendarViewNavigation';
import { toLocalIsoDate } from '../utils';

import { paramsFromLastReplace } from './navigationTestHelpers';

/**
 * Regression test for the real `useCalendarViewNavigation` production hook (not a
 * reimplementation of it). Mocks only the Next navigation boundary (`useSearchParams`/
 * `useRouter`) — the same class of boundary this codebase already mocks (tRPC, session) for
 * component tests.
 *
 * The bug this guards against: `calendar/page.tsx`'s `handleDayNumberClick`/`handleWeekNumberClick`
 * used to call `setViewDate(d)` then `setView(v)` sequentially. Both built their `URLSearchParams`
 * from the same pre-click `searchParams` snapshot (no re-render happens between two synchronous
 * calls in one handler), so the second call's `router.replace` silently discarded the first's. The
 * fix is `setViewAndDate(v, d)` — one composed mutation, one `router.replace`.
 *
 * The fix (and this regression) were verified by temporarily reverting `setViewAndDate` to the
 * old sequential shape and confirming these tests fail against it — that mutation was applied,
 * observed, and reverted during development; it is not, and has never been, committed here.
 *
 * Target dates below are always constructed as `new Date(y, m, d)` (local calendar components),
 * never `new Date('YYYY-MM-DD')` — the latter anchors to UTC midnight, which under a negative UTC
 * offset (e.g. America/Los_Angeles) is the PREVIOUS local calendar day, and would make `date`
 * assertions below fail depending on the host/CI runner's timezone rather than on the production
 * code under test. `new Date(y, m, d)` matches what a real click actually produces (see
 * `dateSerialization.timezone.browser.test.tsx` for the dedicated timezone-direction proof).
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

function Harness({ onReady }: { onReady: (nav: ReturnType<typeof useCalendarViewNavigation>) => void }) {
  const nav = useCalendarViewNavigation();
  onReady(nav);
  return (
    <div>
      <span data-testid="view">{nav.view}</span>
      <span data-testid="date">{toLocalIsoDate(nav.viewDate)}</span>
    </div>
  );
}

async function mountHarness(initialSearch: string) {
  setUrl(initialSearch);
  let nav!: ReturnType<typeof useCalendarViewNavigation>;
  const onReady = (n: ReturnType<typeof useCalendarViewNavigation>) => { nav = n; };
  const screen = await render(<Harness onReady={onReady} />);
  return {
    screen,
    get nav() { return nav; },
    /**
     * Updates what the mocked `useSearchParams()` returns, then actually re-renders the
     * production hook (not just the shared mock's return value) so `nav` reflects a genuinely
     * fresh `searchParams`/`navigate` closure — the same thing a real Next.js navigation would
     * trigger. Reading `nav` after this (not the pre-rerender reference) is what makes this a
     * real re-render rather than a mutation of the previous render's closure out from under it.
     */
    async rerenderWithUrl(search: string) {
      setUrl(search);
      await screen.rerender(<Harness onReady={onReady} />);
    },
  };
}

describe('useCalendarViewNavigation (production hook)', () => {
  test('reads initial view and date from the current URL', async () => {
    const { screen } = await mountHarness('view=week&date=2026-03-05');
    await expect.element(screen.getByTestId('view')).toHaveTextContent('week');
    await expect.element(screen.getByTestId('date')).toHaveTextContent('2026-03-05');
  });

  test('setViewAndDate("day", date) performs exactly one router.replace, with both keys present', async () => {
    const { nav } = await mountHarness('view=month&date=2026-01-01');
    fakeReplace.mockClear();

    nav.setViewAndDate('day', new Date(2026, 2, 5));

    expect(fakeReplace).toHaveBeenCalledTimes(1);
    const written = paramsFromLastReplace(fakeReplace);
    expect(written.get('view')).toBe('day');
    expect(written.get('date')).toBe('2026-03-05');
  });

  test('setViewAndDate("week", date) performs exactly one router.replace, with both keys present', async () => {
    const { nav } = await mountHarness('view=month&date=2026-01-01');
    fakeReplace.mockClear();

    nav.setViewAndDate('week', new Date(2026, 2, 9));

    expect(fakeReplace).toHaveBeenCalledTimes(1);
    const written = paramsFromLastReplace(fakeReplace);
    expect(written.get('view')).toBe('week');
    expect(written.get('date')).toBe('2026-03-09');
  });

  test('a prior toolbar setView is preserved by a subsequent setViewAndDate, across a real re-render', async () => {
    // setView() itself calls router.replace with the CURRENT searchParams snapshot — this test
    // proves that snapshot is honored across an actual re-render of the production hook (not a
    // mutation of the previous render's mock closure), matching what a real Next.js navigation
    // does: useSearchParams() returns a NEW object reflecting the just-written URL.
    const h = await mountHarness('view=month&date=2026-01-01');
    fakeReplace.mockClear();

    h.nav.setView('week');
    expect(fakeReplace).toHaveBeenCalledTimes(1);
    const afterToolbarUrl = paramsFromLastReplace(fakeReplace).toString();
    expect(new URLSearchParams(afterToolbarUrl).get('view')).toBe('week');

    // Actually re-render with the URL the toolbar write produced — `h.nav` below is read AFTER
    // this, so it's the hook's fresh post-rerender closure, not the one captured before it.
    await h.rerenderWithUrl(afterToolbarUrl);
    fakeReplace.mockClear();

    h.nav.setViewAndDate('day', new Date(2026, 2, 5));
    expect(fakeReplace).toHaveBeenCalledTimes(1);
    const finalParams = paramsFromLastReplace(fakeReplace);
    expect(finalParams.get('date')).toBe('2026-03-05');
    expect(finalParams.get('view')).toBe('day');
  });

  test('unrelated current query parameters survive setViewAndDate', async () => {
    const { nav } = await mountHarness('view=month&date=2026-01-01&brandIds=b1,b2&fullscreen=1');
    fakeReplace.mockClear();

    nav.setViewAndDate('day', new Date(2026, 2, 5));

    const written = paramsFromLastReplace(fakeReplace);
    expect(written.get('brandIds')).toBe('b1,b2');
    expect(written.get('fullscreen')).toBe('1');
    expect(written.get('view')).toBe('day');
    expect(written.get('date')).toBe('2026-03-05');
  });
});
