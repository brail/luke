import { afterEach, expect, test, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

import { useMaintenanceStatus } from '../useMaintenanceStatus';

/**
 * The maintenance state needs a session (ADR-042): signed out, nothing is asked and nothing is
 * returned — not an answer cached before a logout, nor one that lands after it — and an SSE push
 * triggers no request.
 */

const { query, session, sse } = vi.hoisted(() => ({
  // Read fresh by the mocked `useQuery` on every render, like the real query transitioning.
  query: {
    data: undefined as { status: string } | undefined,
    isLoading: false,
    refetch: vi.fn(),
    options: undefined as { enabled?: boolean; refetchInterval?: number | false } | undefined,
  },
  session: { status: 'authenticated' as 'authenticated' | 'unauthenticated' | 'loading' },
  sse: { handler: undefined as ((data: { type: string }) => void) | undefined, connected: false },
}));

vi.mock('../../lib/trpc', () => ({
  trpc: {
    maintenance: {
      mode: {
        getStatus: {
          useQuery: (_input: unknown, options: { enabled?: boolean; refetchInterval?: number | false }) => {
            query.options = options;
            return query;
          },
        },
      },
    },
  },
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: session.status }) }));
vi.mock('../../contexts/SseProvider', () => ({
  useSseMessage: (handler: (data: { type: string }) => void) => {
    sse.handler = handler;
  },
  // As the provider's: no polling while the stream is open.
  useSseFallbackPoll: () => (sse.connected ? false : 120_000),
}));

afterEach(() => {
  query.data = undefined;
  query.isLoading = false;
  query.refetch.mockReset();
  query.options = undefined;
  session.status = 'authenticated';
  sse.handler = undefined;
  sse.connected = false;
});

test('signed in, the state is asked for and returned, and an SSE push refreshes it', async () => {
  query.data = { status: 'ACTIVE' };
  const { result } = await renderHook(() => useMaintenanceStatus());

  expect(query.options?.enabled).toBe(true);
  expect(result.current.state).toEqual({ status: 'ACTIVE' });
  sse.handler?.({ type: 'maintenance-mode' });
  expect(query.refetch).toHaveBeenCalledTimes(1);
});

test.each(['unauthenticated', 'loading'] as const)('%s, nothing is asked for and no state is returned', async status => {
  session.status = status;
  const { result } = await renderHook(() => useMaintenanceStatus());

  expect(query.options?.enabled).toBe(false);
  expect(result.current).toEqual({ state: undefined, isLoading: false });
});

test('a state cached before a logout, or landing after it, is not returned', async () => {
  session.status = 'unauthenticated';
  query.data = { status: 'ACTIVE' };
  const { result } = await renderHook(() => useMaintenanceStatus());

  expect(result.current.state).toBeUndefined();
});

test('signed out, an SSE push asks for nothing', async () => {
  session.status = 'unauthenticated';
  await renderHook(() => useMaintenanceStatus());

  sse.handler?.({ type: 'maintenance-mode' });
  expect(query.refetch).not.toHaveBeenCalled();
});

test('polls every 2 minutes only while the stream is down, and catches up when it opens', async () => {
  const { rerender } = await renderHook(() => useMaintenanceStatus());
  expect(query.options?.refetchInterval).toBe(120_000);

  sse.connected = true;
  await rerender();
  expect(query.options?.refetchInterval).toBe(false);
  sse.handler?.({ type: 'connected' });
  expect(query.refetch).toHaveBeenCalledOnce();
});
