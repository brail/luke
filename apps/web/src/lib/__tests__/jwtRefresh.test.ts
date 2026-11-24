/**
 * The JWT callback's token refresh (`src/auth.ts`): at most one `auth.refreshToken` per user every
 * 30 s whatever the outcome, pushed back to the limiter's `Retry-After` after a 429 (30 s at least,
 * 5 minutes at most), never a sign-out on a 429, and a hung API given up after 5 s with the token
 * kept (ADR-051, #239).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JWT } from 'next-auth/jwt';

const h = vi.hoisted(() => ({ debugWarn: vi.fn() }));

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
// The module builds its handlers at load; only `config` is under test.
vi.mock('next-auth', () => ({ default: () => ({}) }));
vi.mock('next-auth/providers/credentials', () => ({ default: () => ({}) }));
vi.mock('../loginAuthorize', () => ({ authorizeLogin: vi.fn() }));
vi.mock('../debug', () => ({ debugLog: vi.fn(), debugError: vi.fn(), debugWarn: h.debugWarn }));

vi.stubEnv('NEXTAUTH_SECRET', 'test-secret');
vi.stubEnv('INTERNAL_API_URL', 'http://api.test:3001');
const { config } = await import('../../auth');

const network = vi.fn<typeof fetch>();
let user = 0;
/** A fresh signed-in token: the refresh cache is per user and lives at module level. */
const signedIn = (): JWT => ({ sub: `user-${++user}`, accessToken: 'old', tokenVersion: 0 });

/** The JWT callback on a later request of the session (not the sign-in, not an update). */
const refresh = (token: JWT) =>
  config.callbacks.jwt({ token, user: undefined, trigger: undefined } as unknown as Parameters<
    typeof config.callbacks.jwt
  >[0]); // The callback's parameter type requires fields Auth.js fills in; this path reads only these.

const tooMany = (headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: true, code: 'TOO_MANY_REQUESTS' }), { status: 429, headers });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', network);
  network.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Calls the callback at each offset (ms from now) and returns at which ones a refresh was sent. */
async function refreshesAt(token: JWT, offsets: number[]): Promise<number[]> {
  const start = Date.now();
  const sent: number[] = [];
  for (const offset of offsets) {
    vi.setSystemTime(start + offset);
    const before = network.mock.calls.length;
    await refresh(token);
    if (network.mock.calls.length > before) sent.push(offset);
  }
  return sent;
}

describe('the JWT refresh', () => {
  it('after a 429, waits for its Retry-After and keeps the session', async () => {
    network.mockResolvedValue(tooMany({ 'retry-after': '45' }));
    const token = signedIn();

    expect(await refresh(token)).toMatchObject({ accessToken: 'old' });
    expect(await refreshesAt(token, [31_000, 44_999, 45_000])).toEqual([45_000]);
  });

  it('after a 429 without Retry-After, waits the usual 30 s', async () => {
    network.mockResolvedValue(tooMany());
    const token = signedIn();
    await refresh(token);

    expect(await refreshesAt(token, [29_999, 30_000])).toEqual([30_000]);
  });

  it('caps a long Retry-After at 5 minutes', async () => {
    network.mockResolvedValue(tooMany({ 'retry-after': '99999' }));
    const token = signedIn();
    await refresh(token);

    expect(await refreshesAt(token, [299_999, 300_000])).toEqual([300_000]);
  });

  it('after a network failure, sends no second refresh within 30 s', async () => {
    network.mockRejectedValue(new TypeError('fetch failed'));
    const token = signedIn();
    await refresh(token);

    expect(await refreshesAt(token, [1_000, 29_999])).toEqual([]);
  });

  it('gives up after 5 s and keeps the token, with a warning', async () => {
    network.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'));
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    expect(await refresh(signedIn())).toMatchObject({ accessToken: 'old' });
    expect(timeout).toHaveBeenCalledWith(5_000);
    expect(network.mock.calls[0]?.[1]?.signal).toBe(timeout.mock.results[0]?.value);
    expect(h.debugWarn).toHaveBeenCalledOnce();
  });

  it('takes the fresh token of a successful refresh', async () => {
    network.mockResolvedValue(Response.json({ result: { data: { token: 'fresh' } } }));

    expect(await refresh(signedIn())).toMatchObject({ accessToken: 'fresh' });
  });
});
