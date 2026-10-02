import { afterEach, describe, expect, it, vi } from 'vitest';

import { IdempotencyStore, idempotencyStore } from '../src/lib/idempotency';
import { withIdempotency } from '../src/lib/idempotencyTrpc';

import { createSilentLogger } from './helpers/logger';

/**
 * `withIdempotency` reserves a key before the mutation runs: a second request with that key
 * while the first is still running is refused, never run twice. Every case drives `next()` with a
 * promise the test settles itself.
 */

const KEY = '00000000-0000-4000-8000-000000000001';

type Result = { ok: boolean; data?: unknown };

function held() {
  let settle!: (result: Result) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<Result>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

/** One call of the middleware on `auth.login`-like input, as `userId` (or anonymous with `null`). */
function call(
  next: () => Promise<Result>,
  { key = KEY, input = { a: 1 }, userId = 'u1' as string | null, scope }: {
    key?: string;
    input?: unknown;
    userId?: string | null;
    scope?: 'anonymous';
  } = {}
) {
  const middleware = withIdempotency(scope ? { scope } : undefined);
  return middleware({
    ctx: {
      req: { headers: { 'idempotency-key': key } },
      session: userId ? { user: { id: userId } } : null,
      logger: createSilentLogger(),
    },
    next,
    path: 'users.create',
    type: 'mutation',
    input,
  });
}

afterEach(() => {
  idempotencyStore.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('withIdempotency — a request still in progress', () => {
  it('refuses a second identical request instead of running it again', async () => {
    const first = held();
    const next = vi.fn(() => first.promise);

    const a = call(next);
    await expect(call(next)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(next).toHaveBeenCalledTimes(1);

    first.settle({ ok: true, data: 'created' });
    await expect(a).resolves.toEqual({ ok: true, data: 'created' });
  });

  it('refuses a different request under the same key', async () => {
    const first = held();
    void call(() => first.promise);
    await expect(call(vi.fn(), { input: { a: 2 } })).rejects.toMatchObject({ code: 'CONFLICT' });
    first.settle({ ok: true });
  });

  it('replays a stored result once the first succeeded', async () => {
    const next = vi.fn(async () => ({ ok: true, data: 'created' }));
    await call(next);
    await expect(call(next)).resolves.toEqual({ ok: true, data: 'created' });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('runs again after a failure, whether reported or thrown', async () => {
    await call(async () => ({ ok: false }));
    const afterReported = vi.fn(async () => ({ ok: true }));
    await call(afterReported, { key: KEY });
    expect(afterReported).toHaveBeenCalledOnce();

    idempotencyStore.clear();
    await expect(call(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const afterThrown = vi.fn(async () => ({ ok: true }));
    await call(afterThrown);
    expect(afterThrown).toHaveBeenCalledOnce();
  });

  it('keeps the reservation past the result TTL and a full result cache', async () => {
    vi.useFakeTimers();
    const first = held();
    void call(() => first.promise);

    vi.setSystemTime(Date.now() + 10 * 60 * 1000); // twice the five-minute TTL
    for (let i = 0; i < 1100; i++) {
      const key = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      const begun = idempotencyStore.begin(`fill:${key}`, 'POST', '/trpc/x', '{}');
      if (begun.kind === 'reserved') idempotencyStore.complete(`fill:${key}`, begun.token, { ok: true });
    }

    await expect(call(vi.fn())).rejects.toMatchObject({ code: 'CONFLICT' });
    first.settle({ ok: true });
  });

  it('releases the reservation when storing the result fails', async () => {
    vi.spyOn(idempotencyStore, 'complete').mockImplementation(() => {
      throw new Error('store down');
    });
    await expect(call(async () => ({ ok: true }))).resolves.toEqual({ ok: true });

    const again = vi.fn(async () => ({ ok: true }));
    await call(again);
    expect(again).toHaveBeenCalledOnce();
  });
});

describe('withIdempotency — scope', () => {
  it('never replays one user\'s result to another using the same key', async () => {
    await call(async () => ({ ok: true, data: 'for u1' }), { userId: 'u1' });
    const forU2 = vi.fn(async () => ({ ok: true, data: 'for u2' }));
    await expect(call(forU2, { userId: 'u2' })).resolves.toEqual({ ok: true, data: 'for u2' });
    expect(forU2).toHaveBeenCalledOnce();
  });

  it('uses one anonymous scope for a public procedure, whether or not a session came along', async () => {
    const next = vi.fn(async () => ({ ok: true, data: 'token' }));
    await call(next, { scope: 'anonymous', userId: null });
    await expect(call(next, { scope: 'anonymous', userId: 'u1' })).resolves.toEqual({ ok: true, data: 'token' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('refuses to run without a session when the scope is the caller', async () => {
    const next = vi.fn(async () => ({ ok: true }));
    await expect(call(next, { userId: null })).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('IdempotencyStore — reservations', () => {
  it('lets a stale completion touch nothing it does not own', () => {
    const store = new IdempotencyStore();
    const first = store.begin('k', 'POST', '/p', '{}');
    if (first.kind !== 'reserved') throw new Error('expected a reservation');
    store.release('k', first.token);

    const second = store.begin('k', 'POST', '/p', '{}');
    if (second.kind !== 'reserved') throw new Error('expected a reservation');
    store.complete('k', first.token, { ok: true, data: 'stale' });

    expect(store.begin('k', 'POST', '/p', '{}').kind).toBe('inFlight');
    store.stop();
  });

  it('answers full only for a new key, still replaying and still refusing running ones', () => {
    const store = new IdempotencyStore(1);
    const stored = store.begin('done', 'POST', '/p', '{}');
    if (stored.kind !== 'reserved') throw new Error('expected a reservation');
    store.complete('done', stored.token, { ok: true, data: 'kept' });
    const running = store.begin('running', 'POST', '/p', '{}');
    expect(running.kind).toBe('reserved');

    expect(store.begin('new', 'POST', '/p', '{}').kind).toBe('full');
    expect(store.begin('done', 'POST', '/p', '{}')).toEqual({ kind: 'hit', response: { ok: true, data: 'kept' } });
    expect(store.begin('running', 'POST', '/p', '{}').kind).toBe('inFlight');
    store.stop();
  });

  it('answers TOO_MANY_REQUESTS through the middleware when the reservations are full', async () => {
    vi.spyOn(idempotencyStore, 'begin').mockReturnValue({ kind: 'full' });
    await expect(call(vi.fn())).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});
