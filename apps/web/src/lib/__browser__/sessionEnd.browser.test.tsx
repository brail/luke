import { focusManager } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { SessionVerification } from '../../components/SessionVerification';
import { trpc, TRPCProvider } from '../trpc';

/**
 * The web's sign-out signal is `data.sessionEnded` and nothing else (ADR-052): any query or
 * mutation answering it signs out, once per page however many arrive; a bare `UNAUTHORIZED` (a
 * wrong current password) does not. A tab coming back to view checks its session. The mutation
 * side is proven by the SSE ticket (`sseSession.browser.test.tsx`).
 *
 * The tests share one page, so `endSession`'s once-flag carries over: the sign-out test runs last.
 */

const h = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated', data: { accessToken: 'token' } }),
  signOut: h.signOut,
}));

const network = vi.fn<typeof fetch>();
const calls = (procedure: string) =>
  network.mock.calls.filter(([input]) => String(input).includes(`/trpc/${procedure}`)).length;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const unauthorized = (data: object = {}) =>
  Response.json(
    { error: { message: 'Sessione non più valida', code: -32001, data: { code: 'UNAUTHORIZED', httpStatus: 401, ...data } } },
    { status: 401 }
  );

function Profile() {
  trpc.me.get.useQuery(undefined, { staleTime: Infinity });
  return null;
}

beforeEach(() => {
  vi.stubGlobal('fetch', network);
});

afterEach(() => {
  network.mockReset();
  vi.unstubAllGlobals();
  focusManager.setFocused(undefined);
});

test('a bare UNAUTHORIZED signs nobody out', async () => {
  network.mockImplementation(async () => unauthorized());
  await render(
    <TRPCProvider>
      <Profile />
    </TRPCProvider>
  );

  await expect.poll(() => calls('me.get')).toBe(1);
  await pause(100);
  expect(h.signOut).not.toHaveBeenCalled();
});

test('a tab coming back to view checks its session', async () => {
  network.mockImplementation(async () => Response.json({ result: { data: null } }));
  await render(
    <TRPCProvider>
      <SessionVerification />
    </TRPCProvider>
  );
  expect(calls('me.get')).toBe(0);

  focusManager.setFocused(false);
  focusManager.setFocused(true);

  await expect.poll(() => calls('me.get')).toBe(1);
});

test('an ended session signs out once, however many calls report it', async () => {
  network.mockImplementation(async () => unauthorized({ sessionEnded: true }));
  await render(
    <TRPCProvider>
      <Profile />
      <SessionVerification />
    </TRPCProvider>
  );
  await expect.poll(() => h.signOut.mock.calls.length).toBe(1);
  expect(h.signOut).toHaveBeenCalledWith({ callbackUrl: '/login' });

  // A second call answering the same: the page is already signing out.
  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await expect.poll(() => calls('me.get')).toBe(2);
  await pause(100);
  expect(h.signOut).toHaveBeenCalledOnce();
});
