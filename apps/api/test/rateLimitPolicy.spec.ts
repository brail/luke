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

import type { PrismaClient } from '@luke/db';

import { getConfig } from '../src/lib/configManager';
import { clearRateLimitConfigCache, resolveRateLimitPolicy } from '../src/lib/rateLimitPolicy';


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
