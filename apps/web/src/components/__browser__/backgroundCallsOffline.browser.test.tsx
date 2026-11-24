import { onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { SseProvider } from '../../contexts/SseProvider';
import { TRPCProvider } from '../../lib/trpc';
import { HeartbeatTicker } from '../HeartbeatTicker';

/**
 * Offline, the heartbeat and the SSE ticket fail instead of pausing: a paused mutation is replayed
 * when the network comes back, and W8a measured 14 queued heartbeats per tab arriving at once (#239).
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated', data: { accessToken: 'token' } }),
  signOut: vi.fn(),
}));

const network = vi.fn(async (..._args: Parameters<typeof fetch>): Promise<Response> => {
  throw new TypeError('Failed to fetch');
});

/** The tRPC procedures the page tried to reach. */
const proceduresCalled = () => network.mock.calls.map(([input]) => String(input).split('/trpc/')[1]?.split('?')[0]);

beforeEach(() => {
  // The lowest jitter: the SSE reconnect still waits half its 5 s backoff, so a second ticket call
  // inside the test's window would be a replay, not the reconnect.
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.stubGlobal('fetch', network);
  onlineManager.setOnline(false);
});

afterEach(() => {
  network.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

test.each([
  ['the heartbeat', 'users.heartbeat', <HeartbeatTicker key="h" />],
  ['the SSE ticket', 'notifications.getSseTicket', <SseProvider key="s">{null}</SseProvider>],
])('offline, %s is tried and fails, and is not replayed on reconnect', async (_name, procedure, ui) => {
  await render(<TRPCProvider>{ui}</TRPCProvider>);

  await expect.poll(proceduresCalled).toEqual([procedure]);
  onlineManager.setOnline(true);
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(proceduresCalled()).toEqual([procedure]);
});
