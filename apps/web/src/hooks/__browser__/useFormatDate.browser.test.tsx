import { afterEach, expect, test, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

import { calendarDateIn, calendarDateOf, formatInstant, NUMERIC_DATE_TIME } from '@luke/core';

import { useFormatDate } from '../useFormatDate';

/**
 * Dates are read in the profile zone `me.get` resolves and written in the one default locale
 * (ADR-035): never in a zone written in the hook while `me.get` loads or after it fails, and never
 * in the locale saved on the profile.
 */

const { meQuery, session, toastError } = vi.hoisted(() => ({
  // Read fresh by the mocked `useQuery` on every render, like the real query transitioning.
  meQuery: { data: undefined as { timezone: string; locale: string } | undefined, error: null as Error | null },
  session: { status: 'authenticated' as 'authenticated' | 'unauthenticated' },
  toastError: vi.fn(),
}));

vi.mock('../../lib/trpc', () => ({ trpc: { me: { get: { useQuery: () => meQuery } } } }));
vi.mock('next-auth/react', () => ({
  useSession: () => (session.status === 'authenticated' ? { data: { accessToken: 't' }, status: 'authenticated' } : { data: null, status: 'unauthenticated' }),
}));
vi.mock('sonner', () => ({ toast: { error: toastError } }));

afterEach(() => {
  meQuery.data = undefined;
  meQuery.error = null;
  session.status = 'authenticated';
  vi.useRealTimers();
  toastError.mockReset();
});

const INSTANT = '2026-01-15T10:30:00.000Z';

test('while the profile zone loads, dates show a placeholder rather than another zone', async () => {
  const { result } = await renderHook(() => useFormatDate());

  expect(result.current.date(INSTANT)).toBe('…');
  expect(result.current.dateTime(INSTANT)).toBe('…');
  expect(result.current.time(INSTANT)).toBe('…');
  expect(result.current.ready).toBe(false);
  expect(toastError).not.toHaveBeenCalled();
});

test('dates are written in the profile zone and the default locale, whatever locale the profile holds', async () => {
  meQuery.data = { timezone: 'Asia/Shanghai', locale: 'en-US' };
  const { result } = await renderHook(() => useFormatDate());

  expect(result.current.dateTime(INSTANT)).toBe('15/01/2026, 18:30');
  expect(result.current.time(new Date(INSTANT))).toBe('18:30');
  expect(result.current.today).toBe(calendarDateIn(new Date(), 'Asia/Shanghai'));
  expect(result.current).toMatchObject({ ready: true, zone: 'Asia/Shanghai', locale: 'it-IT' });
});

test("a date alone is the instant's day in the profile zone, not the browser's", async () => {
  meQuery.data = { timezone: 'America/Los_Angeles', locale: 'it-IT' };
  const { result } = await renderHook(() => useFormatDate());

  // 1 February in UTC and east of it, where the browser runs; still 31 January in Los Angeles.
  expect(result.current.date('2026-02-01T05:30:00.000Z')).toBe('31/01/2026');
  // @ts-expect-error a calendar day is not an instant: `formatCalendarDate` writes it, without a zone
  result.current.date(calendarDateOf(new Date('2026-01-15T00:00:00.000Z')));
});

test('without a session there is no profile zone: the browser zone dates instants, and every value names it', async () => {
  session.status = 'unauthenticated';
  const { result } = await renderHook(() => useFormatDate());

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  expect(result.current).toMatchObject({ ready: true, zone });
  expect(result.current.dateTime(INSTANT)).toBe(`${formatInstant(new Date(INSTANT), zone, NUMERIC_DATE_TIME, 'it-IT')} (${zone})`);
});

test('a relative time counts days in the profile zone, not the browser zone', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // 01:00 on 17 January in Shanghai, 18:00 on 16 January in Rome; INSTANT is 15 January either way.
  vi.setSystemTime(new Date('2026-01-16T17:00:00Z'));
  meQuery.data = { timezone: 'Asia/Shanghai', locale: 'it-IT' };
  const { result } = await renderHook(() => useFormatDate());

  expect(result.current.relative(INSTANT)).toBe('l’altro ieri');
});

test('a profile zone this browser does not know leaves the placeholder and one toast naming it, never a throw', async () => {
  meQuery.data = { timezone: 'Mars/Olympus_Mons', locale: 'it-IT' };
  const { result } = await renderHook(() => useFormatDate());

  expect(result.current.dateTime(INSTANT)).toBe('…');
  expect(result.current.ready).toBe(false);
  await vi.waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
  expect(toastError).toHaveBeenCalledWith(expect.stringContaining('Mars/Olympus_Mons'), { id: 'reader-zone' });
});

test('a failed profile read leaves the placeholder and exposes the error, with no time-zone toast', async () => {
  meQuery.error = new Error('down');
  const { result } = await renderHook(() => useFormatDate());

  expect(result.current.dateTime(INSTANT)).toBe('…');
  expect(result.current).toMatchObject({ ready: false, error: meQuery.error });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(toastError).not.toHaveBeenCalled();
});

test('a failed refetch with the zone already known exposes no error: dates are still shown', async () => {
  meQuery.data = { timezone: 'Europe/Rome', locale: 'it-IT' };
  meQuery.error = new Error('down');
  const { result } = await renderHook(() => useFormatDate());

  expect(result.current).toMatchObject({ ready: true, error: null });
  expect(result.current.dateTime(INSTANT)).toBe('15/01/2026, 11:30');
});
