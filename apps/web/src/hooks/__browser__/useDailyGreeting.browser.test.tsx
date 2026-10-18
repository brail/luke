import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

import { useDailyGreeting } from '../useDailyGreeting';

/**
 * The daily greeting shows once per day of the profile zone — the zone its greeting is written
 * in — not once per day of the browser (Rome locally, UTC in CI).
 */

const { greeting } = vi.hoisted(() => ({ greeting: vi.fn() }));

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 't' }, status: 'authenticated' }) }));
vi.mock('../../lib/trpc', () => ({
  trpc: {
    me: {
      get: { useQuery: () => ({ data: { timezone: 'Asia/Shanghai' }, error: null }) },
      getDailyGreeting: { useQuery: greeting },
    },
  },
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // 23:00 on 4 January in Rome, already 06:00 on 5 January in Shanghai.
  vi.setSystemTime(new Date('2026-01-04T22:00:00Z'));
  greeting.mockReturnValue({ data: { enabled: true, greeting: 'Buongiorno' } });
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  greeting.mockReset();
});

test("a greeting seen on the profile zone's day is not shown again that day", async () => {
  localStorage.setItem('luke-greeting-seen-2026-01-05', '1');
  const { result } = await renderHook(() => useDailyGreeting());

  expect(result.current.shouldShow).toBe(false);
  expect(greeting).toHaveBeenLastCalledWith(undefined, { enabled: false });
});

test("a flag of the browser's day does not hide the greeting of the profile zone's day", async () => {
  localStorage.setItem('luke-greeting-seen-2026-01-04', '1');
  const { result } = await renderHook(() => useDailyGreeting());

  await vi.waitFor(() => expect(result.current.shouldShow).toBe(true));
  expect(localStorage.getItem('luke-greeting-seen-2026-01-05')).toBe('1');
});
