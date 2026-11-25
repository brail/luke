import { afterEach, expect, test, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

import { useNotifications } from '../useNotifications';

/**
 * Notifications poll every 2 minutes only while the SSE stream is down, and refetch when it opens
 * to catch up on what it missed (ADR-052).
 */

const { intervals, sse, invalidate } = vi.hoisted(() => ({
  intervals: [] as (number | false | undefined)[],
  sse: { handler: undefined as ((data: { type: string }) => void) | undefined, connected: false },
  invalidate: vi.fn(),
}));

vi.mock('../../lib/trpc', () => {
  const useQuery = (_input: unknown, options: { refetchInterval?: number | false }) => {
    intervals.push(options.refetchInterval);
    return { data: undefined, isLoading: false };
  };
  return {
    trpc: {
      useUtils: () => ({ notifications: { list: { invalidate }, counts: { invalidate } } }),
      notifications: { list: { useQuery }, counts: { useQuery } },
    },
  };
});
vi.mock('../../contexts/AppContextProvider', () => ({ useAppContext: () => ({ season: undefined }) }));
vi.mock('../../contexts/SseProvider', () => ({
  useSseMessage: (handler: (data: { type: string }) => void) => {
    sse.handler = handler;
  },
  // As the provider's: no polling while the stream is open.
  useSseFallbackPoll: () => (sse.connected ? false : 120_000),
}));

afterEach(() => {
  intervals.splice(0);
  invalidate.mockReset();
  sse.connected = false;
});

test('polls every 2 minutes only while the stream is down, and catches up when it opens', async () => {
  const { rerender } = await renderHook(() => useNotifications());
  expect(intervals.slice(-2)).toEqual([120_000, 120_000]);

  sse.connected = true;
  await rerender();
  expect(intervals.slice(-2)).toEqual([false, false]);
  sse.handler?.({ type: 'connected' });
  expect(invalidate).toHaveBeenCalledTimes(2);
});
