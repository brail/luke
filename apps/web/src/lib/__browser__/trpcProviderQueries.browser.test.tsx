import { onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { createQueryClient, trpc, TRPCProvider } from '../trpc';


/**
 * The query defaults of `TRPCProvider` (ADR-051's client side, #239): a 4xx is not retried, and the
 * network coming back refetches a stale query once, after the random wait, not at the same instant.
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated', data: { accessToken: 'token' } }),
}));

const network = vi.fn<typeof fetch>();
const profileCalls = () => network.mock.calls.filter(([input]) => String(input).includes('/trpc/me.get')).length;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function Profile() {
  trpc.me.get.useQuery(undefined, { staleTime: 0 });
  return null;
}

beforeEach(() => {
  vi.stubGlobal('fetch', network);
  onlineManager.setOnline(true);
});

afterEach(() => {
  network.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

test('a 4xx is not retried', async () => {
  // No backoff, so a retry would come at once.
  vi.spyOn(Math, 'random').mockReturnValue(0);
  network.mockImplementation(async () =>
    Response.json(
      { error: { message: 'Forbidden', code: -32003, data: { code: 'FORBIDDEN', httpStatus: 403 } } },
      { status: 403 }
    )
  );
  await render(
    <TRPCProvider>
      <Profile />
    </TRPCProvider>
  );

  await expect.poll(profileCalls).toBe(1);
  await pause(300);
  expect(profileCalls()).toBe(1);
});

test('the network coming back refetches a stale query once, after the random wait', async () => {
  // 4% of the 5 s spread: the refetch comes 200 ms after the network.
  vi.spyOn(Math, 'random').mockReturnValue(0.04);
  network.mockImplementation(async () => Response.json({ result: { data: null } }));
  await render(
    <TRPCProvider>
      <Profile />
    </TRPCProvider>
  );
  await expect.poll(profileCalls).toBe(1);
  // React Query's own reconnect refetch would send every stale query at once; it must stay off.
  // Asserted on the option: this environment does not show its refetch.
  expect(createQueryClient().getDefaultOptions().queries?.refetchOnReconnect).toBe(false);

  onlineManager.setOnline(false);
  onlineManager.setOnline(true);

  await pause(50);
  expect(profileCalls()).toBe(1);
  await expect.poll(profileCalls).toBe(2);
  await pause(300);
  expect(profileCalls()).toBe(2);
});
