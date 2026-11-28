/**
 * The web half of one idempotency key per action (#248): `uuidV4` gives what the API's key check
 * accepts, in a secure context and outside one; the browser's links send a keyed call alone with its
 * key, keep every other call as it was, and leave a keyed call's 429 handling unchanged.
 */

import { TRPCClientError, createTRPCClient } from '@trpc/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AppRouter } from '@luke/api';

import { attachIdempotencyKey, idempotencyKeyOf } from '../idempotencyKey';
import { browserLinks } from '../trpcLinks';
import { uuidV4 } from '../uuid';

/** The API's own check (`withIdempotency`, apps/api/src/lib/idempotencyTrpc.ts). */
const SERVER_UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

afterEach(() => vi.unstubAllGlobals());

describe('uuidV4', () => {
  it('is a v4 the API accepts, with crypto.randomUUID', () => {
    expect(uuidV4()).toMatch(SERVER_UUID_V4);
  });

  it('is a v4 the API accepts over plain HTTP, where crypto.randomUUID is missing', () => {
    const { getRandomValues } = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: getRandomValues.bind(globalThis.crypto) });
    const keys = Array.from({ length: 200 }, uuidV4);
    expect(keys.filter(key => !SERVER_UUID_V4.test(key))).toEqual([]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('browserLinks', () => {
  const sent: Array<{ url: URL; headers: Headers }> = [];

  /** Records each request; answers with `respond`, or with a plain success. */
  function serverAnswers(respond: () => Response = () => Response.json({ result: { data: { id: 'v1' } } })) {
    sent.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: Parameters<typeof fetch>[1]) => {
        sent.push({ url: new URL(String(input), 'http://web.test'), headers: new Headers(init?.headers) });
        return respond();
      })
    );
  }

  const client = () => createTRPCClient<AppRouter>({ links: browserLinks('api-token') });

  it('sends a keyed mutation alone, with its key', async () => {
    serverAnswers();
    const payload = { name: 'Vendor', moqPerColor: 100 };
    attachIdempotencyKey(payload);

    await client().vendors.create.mutate(payload);

    expect(sent).toHaveLength(1);
    expect(sent[0].url.pathname).toBe('/trpc/vendors.create');
    expect(sent[0].url.searchParams.has('batch')).toBe(false);
    expect(sent[0].headers.get('idempotency-key')).toBe(idempotencyKeyOf(payload));
    expect(sent[0].headers.get('authorization')).toBe('Bearer api-token');
  });

  it('keeps calls without a key in the streaming batch, with no key header', async () => {
    serverAnswers();
    const c = client();

    await Promise.allSettled([
      c.vendors.create.mutate({ name: 'Vendor', moqPerColor: 100 }),
      c.brand.list.query({ limit: 10 }),
    ]);

    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every(request => request.url.searchParams.get('batch') === '1')).toBe(true);
    expect(sent.some(request => request.headers.has('idempotency-key'))).toBe(false);
  });

  it("answers a keyed call's 429 with the wait, as for any call (ADR-051)", async () => {
    serverAnswers(() => new Response('Too Many Requests', { status: 429, headers: { 'Retry-After': '7' } }));
    const payload = { name: 'Vendor', moqPerColor: 100 };
    attachIdempotencyKey(payload);

    const error = await client().vendors.create.mutate(payload).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TRPCClientError);
    expect((error as TRPCClientError<AppRouter>).data).toMatchObject({ code: 'TOO_MANY_REQUESTS', retryAfterSeconds: 7 });
  });
});
