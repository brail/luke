/**
 * The exchange-rate widget compares the latest ECB fixing with the one before it. It took "yesterday"
 * as the UTC date 24 hours ago, which on a weekend or a morning before the fixing is published fell
 * on the same fixing as "latest", and one base Frankfurter failed for failed the whole query, while a
 * Frankfurter that failed for every base must still fail it.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let caller: ReturnType<typeof createCallerWithSession>;

beforeAll(async () => {
  await setupTestDb();
  caller = createCallerWithSession((await createTestUser('admin')).session);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Frankfurter answering each requested path with `answers[path]`, or 503; the paths asked, in `urls`. */
function stubFrankfurter(answers: Record<string, unknown>) {
  const urls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    urls.push(url);
    const body = answers[url.replace('https://api.frankfurter.app/', '')];
    return body === undefined ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => body };
  }));
  return urls;
}

describe('dashboard.getForexRates', () => {
  it('compares the latest fixing with the one before it', async () => {
    // Monday 6 July before the fixing: latest is Friday 3 July; the day before it answers Thursday 2 July.
    const urls = stubFrankfurter({
      'latest?from=EUR&to=USD': { date: '2026-07-03', rates: { USD: 1.1 } },
      '2026-07-02?from=EUR&to=USD': { date: '2026-07-02', rates: { USD: 1.0 } },
    });

    expect(await caller.dashboard.getForexRates({ pairs: ['EUR/USD'] })).toEqual({
      rates: { 'EUR/USD': 1.1 }, previousRates: { 'EUR/USD': 1.0 }, timestamp: '2026-07-03',
    });
    expect(urls).toContain('https://api.frankfurter.app/2026-07-02?from=EUR&to=USD');
  });

  it('keeps the other bases when Frankfurter fails or answers something else for one', async () => {
    stubFrankfurter({
      'latest?from=EUR&to=USD': { date: '2026-07-03', rates: { USD: 1.1 } },
      '2026-07-02?from=EUR&to=USD': { date: '2026-07-02', rates: { USD: 1.0 } },
      'latest?from=GBP&to=USD': { message: 'not found' },
      // CHF's latest fixing arrives, the one before it does not.
      'latest?from=CHF&to=EUR': { date: '2026-07-03', rates: { EUR: 1.05 } },
    });

    expect(await caller.dashboard.getForexRates({ pairs: ['EUR/USD', 'USD/JPY', 'GBP/USD', 'CHF/EUR'] })).toEqual({
      rates: { 'EUR/USD': 1.1, 'CHF/EUR': 1.05 }, previousRates: { 'EUR/USD': 1.0 }, timestamp: '2026-07-03',
    });
  });

  it('fails when Frankfurter answers for no base, so the client keeps the rates it has', async () => {
    stubFrankfurter({});
    await expect(caller.dashboard.getForexRates({ pairs: ['EUR/USD'] })).rejects.toMatchObject({ code: 'BAD_GATEWAY' });
  });
});
