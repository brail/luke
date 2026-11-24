/**
 * The browser's query retries and reconnect refetch (ADR-051's client side): a 4xx is never retried
 * but a 429 is, once, after the server's wait; the network coming back refetches the active, stale
 * queries once, after a random wait a new disconnection cancels.
 */

import { onlineManager, QueryClient, QueryObserver } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { queryRetryDelay, refetchOnReconnectWithJitter, shouldRetryQuery } from '../queryRetry';

/** A failed tRPC call as the link reports it: `data` is the error's `data` from the API. */
const trpcFailure = (data: Record<string, unknown>) =>
  new TRPCClientError('failed', { result: { error: { message: 'failed', code: -32000, data } } });

const NETWORK_FAILURE = new TRPCClientError('Failed to fetch');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shouldRetryQuery', () => {
  it.each([400, 401, 403, 404, 409])('never retries a %i', httpStatus => {
    expect(shouldRetryQuery(0, trpcFailure({ code: 'X', httpStatus }))).toBe(false);
  });

  it('retries a 429 once, when the server said how long to wait', () => {
    const tooMany = trpcFailure({ code: 'TOO_MANY_REQUESTS', httpStatus: 429, retryAfterSeconds: 12 });

    expect(shouldRetryQuery(0, tooMany)).toBe(true);
    expect(shouldRetryQuery(1, tooMany)).toBe(false);
  });

  it('does not retry a 429 without a wait', () => {
    expect(shouldRetryQuery(0, trpcFailure({ code: 'TOO_MANY_REQUESTS', httpStatus: 429 }))).toBe(false);
  });

  it('does not retry a 429 whose wait is longer than a minute', () => {
    const tooMany = (retryAfterSeconds: number) =>
      trpcFailure({ code: 'TOO_MANY_REQUESTS', httpStatus: 429, retryAfterSeconds });

    expect(shouldRetryQuery(0, tooMany(60))).toBe(true);
    expect(shouldRetryQuery(0, tooMany(61))).toBe(false);
  });

  it.each([
    ['a 5xx', trpcFailure({ code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 })],
    ['a network failure', NETWORK_FAILURE],
    ['an error from outside tRPC', new Error('boom')],
  ])('retries %s twice', (_name, error) => {
    expect([0, 1, 2].map(count => shouldRetryQuery(count, error))).toEqual([true, true, false]);
  });
});

describe('queryRetryDelay', () => {
  it("waits the server's Retry-After on a 429, plus up to a second's spread", () => {
    const tooMany = trpcFailure({ code: 'TOO_MANY_REQUESTS', httpStatus: 429, retryAfterSeconds: 12 });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);

    expect(queryRetryDelay(0, tooMany)).toBe(12_000);
    random.mockReturnValue(0.999);
    expect(queryRetryDelay(0, tooMany)).toBe(12_999);
  });

  it('otherwise backs off exponentially with full jitter', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    expect(queryRetryDelay(0, NETWORK_FAILURE)).toBe(500);
    expect(queryRetryDelay(1, NETWORK_FAILURE)).toBe(1_000);
    expect(queryRetryDelay(9, NETWORK_FAILURE)).toBe(15_000);
  });
});

describe('refetchOnReconnectWithJitter', () => {
  let queryClient: QueryClient;
  let stop: () => void;
  const fetched: string[] = [];

  /** A cached query, fresh (`staleTime: Infinity`) or stale, watched by an observer (active) or not. */
  function addQuery(key: string, { stale, active }: { stale: boolean; active: boolean }) {
    const staleTime = stale ? 0 : Infinity;
    queryClient.setQueryDefaults([key], {
      staleTime,
      queryFn: () => {
        fetched.push(key);
        return key;
      },
    });
    queryClient.setQueryData([key], key);
    if (active) new QueryObserver(queryClient, { queryKey: [key], staleTime, refetchOnMount: false }).subscribe(() => {});
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnReconnect: false, retry: false } } });
    fetched.length = 0;
    onlineManager.setOnline(true);
    addQuery('active-stale', { stale: true, active: true });
    addQuery('active-fresh', { stale: false, active: true });
    addQuery('inactive-stale', { stale: true, active: false });
    stop = refetchOnReconnectWithJitter(queryClient);
  });

  afterEach(() => {
    stop();
    queryClient.clear();
    onlineManager.setOnline(true);
    vi.useRealTimers();
  });

  it('refetches only the active, stale queries, once, after the random wait', async () => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);

    await vi.advanceTimersByTimeAsync(2_499);
    expect(fetched).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetched).toEqual(['active-stale']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetched).toEqual(['active-stale']);
  });

  // Observed on the call, not on the fetches: offline, React Query pauses a refetch anyway.
  it('a new disconnection cancels the wait', async () => {
    const refetch = vi.spyOn(queryClient, 'refetchQueries');
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(1_000);
    onlineManager.setOnline(false);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(refetch).not.toHaveBeenCalled();
  });

  it('leaves a query that is already fetching, or waiting for its retry, to finish', async () => {
    let calls = 0;
    const busy = new QueryObserver(queryClient, {
      queryKey: ['busy'],
      staleTime: 0,
      refetchOnMount: false,
      queryFn: () => {
        calls += 1;
        return new Promise<string>(() => {});
      },
    });
    queryClient.setQueryData(['busy'], 'old');
    busy.subscribe(() => {});
    void busy.refetch();
    expect(calls).toBe(1);

    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(calls).toBe(1);
  });

  it('stops listening once unsubscribed', async () => {
    stop();
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetched).toEqual([]);
  });
});
