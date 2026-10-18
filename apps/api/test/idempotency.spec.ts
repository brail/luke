/**
 * Tests for the idempotency store: stored results, their identity and expiry. The reservation
 * lifecycle and the middleware are covered in `idempotencyTrpc.spec.ts`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

import { IdempotencyStore } from '../src/lib/idempotency';

const METHOD = 'POST';
const PATH = '/trpc/auth.login';
const BODY = JSON.stringify({ username: 'test', password: 'test' });
const RESPONSE = { user: { id: '123', email: 'test@example.com' } };

let store: IdempotencyStore;

/** Runs one request to completion under `key` with `response`. */
function complete(key: string, response: unknown, body = BODY, path = PATH, method = METHOD) {
  const begun = store.begin(key, method, path, body);
  if (begun.kind !== 'reserved') throw new Error(`expected a reservation, got ${begun.kind}`);
  store.complete(key, begun.token, response);
}

afterEach(() => {
  store?.stop();
  vi.useRealTimers();
});

describe('Idempotency Store', () => {
  it('reserves a new key', () => {
    store = new IdempotencyStore();
    expect(store.begin('k', METHOD, PATH, BODY).kind).toBe('reserved');
  });

  it('replays the stored response of the same request', () => {
    store = new IdempotencyStore();
    complete('k', RESPONSE);
    expect(store.begin('k', METHOD, PATH, BODY)).toEqual({ kind: 'hit', response: RESPONSE });
  });

  it('answers a conflict for a different request under the same key', () => {
    store = new IdempotencyStore();
    complete('k', RESPONSE);
    expect(store.begin('k', METHOD, PATH, JSON.stringify({ username: 'other' })).kind).toBe('conflict');
    expect(store.begin('k', 'GET', PATH, BODY).kind).toBe('conflict');
    expect(store.begin('k', METHOD, '/trpc/me.get', BODY).kind).toBe('conflict');
  });

  it('keeps keys apart', () => {
    store = new IdempotencyStore();
    complete('k1', RESPONSE);
    expect(store.begin('k2', METHOD, PATH, BODY).kind).toBe('reserved');
  });

  it('forgets a stored response after its TTL', () => {
    vi.useFakeTimers();
    store = new IdempotencyStore(1000, 5 * 60 * 1000);
    complete('k', RESPONSE);
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);
    expect(store.begin('k', METHOD, PATH, BODY).kind).toBe('reserved');
  });

  it('evicts the oldest stored response when full', () => {
    store = new IdempotencyStore(2);
    complete('a', 'A');
    complete('b', 'B');
    complete('c', 'C');
    expect(store.begin('a', METHOD, PATH, BODY).kind).toBe('reserved');
    expect(store.begin('c', METHOD, PATH, BODY)).toEqual({ kind: 'hit', response: 'C' });
  });

  it('reports stored results and requests in progress', () => {
    store = new IdempotencyStore(10, 1000);
    complete('a', 'A');
    store.begin('b', METHOD, PATH, BODY);
    expect(store.getStats()).toEqual({ size: 1, inFlight: 1, maxSize: 10, ttlMs: 1000 });

    store.clear();
    expect(store.getStats()).toMatchObject({ size: 0, inFlight: 0 });
  });
});
