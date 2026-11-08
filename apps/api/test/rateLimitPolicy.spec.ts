/**
 * Cache of the AppConfig `rateLimit` blob in `resolveRateLimitPolicy` (rateLimitPolicy.ts).
 * `auth.login` resolves two buckets in the same attempt (`login` via `withRateLimit`,
 * `loginByUsername` in `authenticateUser()`) — without this cache, every login attempt
 * makes two identical queries against the same AppConfig row.
 *
 * `vi.mock` (not `vi.spyOn` on an import with a named export) because a spy on the
 * module object doesn't always intercept the binding used by `rateLimitPolicy.ts` — see lessons.md
 * → "vi.mock doesn't always intercept: assert on the effect, not on the spy".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { RateLimitConfigSchema } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { getConfig } from '../src/lib/configManager';
import {
  clearRateLimitConfigCache,
  RATE_LIMIT_POLICY_DEFAULTS,
  resolveRateLimitPolicy,
} from '../src/lib/rateLimitPolicy';


vi.mock('../src/lib/configManager', () => ({
  getConfig: vi.fn(),
}));

// getConfig is mocked above: prisma is never actually read in these tests.
const fakePrisma = {} as unknown as PrismaClient;

describe('resolveRateLimitPolicy — cache of the AppConfig rateLimit blob', () => {
  beforeEach(() => {
    clearRateLimitConfigCache();
    vi.mocked(getConfig).mockReset();
    vi.mocked(getConfig).mockResolvedValue(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('two resolutions for different routes within the TTL read AppConfig once', async () => {
    await resolveRateLimitPolicy('login', fakePrisma);
    await resolveRateLimitPolicy('loginByUsername', fakePrisma);

    expect(getConfig).toHaveBeenCalledTimes(1);
  });

  it('after the TTL expires, the next resolution reads AppConfig again', async () => {
    await resolveRateLimitPolicy('login', fakePrisma);
    vi.advanceTimersByTime(2001);
    await resolveRateLimitPolicy('login', fakePrisma);

    expect(getConfig).toHaveBeenCalledTimes(2);
  });

  it('a valid AppConfig value stays the one served by the cache until it expires', async () => {
    vi.mocked(getConfig).mockResolvedValue(
      JSON.stringify({ login: { max: 1, timeWindow: '30s', keyBy: 'ip' } })
    );

    const first = await resolveRateLimitPolicy('login', fakePrisma);
    // Even if the AppConfig row "changed" in the meantime, within the TTL it's ignored.
    vi.mocked(getConfig).mockResolvedValue(
      JSON.stringify({ login: { max: 99, timeWindow: '30s', keyBy: 'ip' } })
    );
    const second = await resolveRateLimitPolicy('login', fakePrisma);

    expect(first.max).toBe(1);
    expect(second.max).toBe(1);
    expect(getConfig).toHaveBeenCalledTimes(1);
  });
});

describe('resolveRateLimitPolicy — a stored entry is validated per route', () => {
  beforeEach(() => {
    clearRateLimitConfigCache();
    vi.mocked(getConfig).mockReset();
  });

  const stored = (value: unknown) => vi.mocked(getConfig).mockResolvedValue(JSON.stringify(value));

  it('a bad entry on another route keeps this route\'s override', async () => {
    stored({
      login: { max: 1, timeWindow: '30s', keyBy: 'ip' },
      exportGeneration: { max: 5, timeWindow: 'soon', keyBy: 'userId' },
    });

    expect(await resolveRateLimitPolicy('login', fakePrisma)).toEqual({ max: 1, windowMs: 30_000, keyBy: 'ip' });
    expect((await resolveRateLimitPolicy('exportGeneration', fakePrisma)).max).toBe(
      RATE_LIMIT_POLICY_DEFAULTS.exportGeneration.max
    );
  });

  it('a window with a leading zero still reads', async () => {
    stored({ login: { max: 2, timeWindow: '01m', keyBy: 'ip' } });

    expect((await resolveRateLimitPolicy('login', fakePrisma)).windowMs).toBe(60_000);
  });

  it('every built-in default is a policy the schema accepts', () => {
    // The defaults are hand-written strings: a window typo would otherwise surface as a throw on
    // the request path, the one path with no fallback.
    expect(RateLimitConfigSchema.safeParse(RATE_LIMIT_POLICY_DEFAULTS).error).toBeUndefined();
  });

  it.each([
    ['is not an object', () => stored([1, 2])],
    ['is not JSON', () => vi.mocked(getConfig).mockResolvedValue('{not json')],
    ['cannot be read', () => vi.mocked(getConfig).mockRejectedValue(new Error('database unreachable'))],
  ])('a value that %s leaves every route on its default', async (_case, arrange) => {
    arrange();

    expect((await resolveRateLimitPolicy('login', fakePrisma)).max).toBe(RATE_LIMIT_POLICY_DEFAULTS.login.max);
  });
});
