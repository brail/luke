import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { googleErrorStatus, withRetry } from '../retry.js';

/**
 * Google answers a rate limit with a 429 or with a 403 whose reason names the limit. Both are
 * worth another try; any other 4xx (a refused email, a missing calendar) never succeeds on a retry.
 */

/** A Google API error as gaxios builds it: the HTTP status in `code`, the reasons in the body. */
function googleError(status: number, reason?: string) {
  return Object.assign(new Error(`status ${status}`), {
    code: status,
    response: { data: { error: { errors: reason ? [{ reason }] : [] } } },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Runs `withRetry` to completion, letting its back-off timers fire. */
async function settle<T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> {
  const settled = Promise.allSettled([promise]);
  await vi.runAllTimersAsync();
  const [result] = await settled;
  return result;
}

describe('withRetry', () => {
  it.each([
    ['429', googleError(429)],
    ['403 rateLimitExceeded', googleError(403, 'rateLimitExceeded')],
    ['403 userRateLimitExceeded', googleError(403, 'userRateLimitExceeded')],
    ['500', googleError(500)],
    ['a network error', Object.assign(new Error('reset'), { code: 'ECONNRESET' })],
  ])('retries %s', async (_label, err) => {
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('ok');

    const result = await settle(withRetry(fn));

    expect(result).toEqual({ status: 'fulfilled', value: 'ok' });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['403 forbidden', googleError(403, 'forbidden')],
    ['403 without a reason', googleError(403)],
    ['404', googleError(404)],
    ['400', googleError(400, 'invalid')],
  ])('does not retry %s', async (_label, err) => {
    const fn = vi.fn().mockRejectedValue(err);

    const result = await settle(withRetry(fn));

    expect(result).toEqual({ status: 'rejected', reason: err });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after three attempts with the last error', async () => {
    const err = googleError(429);
    const fn = vi.fn().mockRejectedValue(err);

    const result = await settle(withRetry(fn));

    expect(result).toEqual({ status: 'rejected', reason: err });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('googleErrorStatus', () => {
  it('reads the HTTP status of a Google API error', () => {
    expect(googleErrorStatus(googleError(404))).toBe(404);
  });

  it('is undefined for a network error, whose code is a string', () => {
    expect(googleErrorStatus(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBeUndefined();
  });
});
