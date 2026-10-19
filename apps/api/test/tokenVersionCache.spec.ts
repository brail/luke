import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

// The TTL reader is the only configuration the cache touches; each test controls when it answers.
let ttlAnswer: () => Promise<number> = async () => 60_000;
vi.mock('../src/lib/configManager', () => ({
  getTokenVersionCacheTTL: () => ttlAnswer(),
}));

type Row = { tokenVersion: number; isActive: boolean };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A client whose `user.findUnique` answers with the queued results, in order. */
function clientAnswering(...answers: Array<Row | Promise<Row>>) {
  const findUnique = vi.fn(async () => answers.shift());
  // Only `user.findUnique` is used by the cache.
  const prisma = { user: { findUnique } } as unknown as PrismaClient;
  return { prisma, findUnique };
}

// A fresh module per test: the cache and its TTL memo are module state.
async function load() {
  return import('../src/lib/tokenVersionCache');
}

beforeEach(() => {
  vi.resetModules();
  ttlAnswer = async () => 60_000;
});

describe('verifyTokenVersion — an invalidation during a fill is not undone', () => {
  it('does not cache a row read while the user was invalidated', async () => {
    const { verifyTokenVersion, invalidateTokenVersionCache } = await load();
    const read = deferred<Row>();
    const { prisma, findUnique } = clientAnswering(read.promise, { tokenVersion: 2, isActive: true });

    const inFlight = verifyTokenVersion('u', 1, prisma);
    await vi.waitFor(() => expect(findUnique).toHaveBeenCalledTimes(1));
    invalidateTokenVersionCache('u');
    read.resolve({ tokenVersion: 1, isActive: true });
    await inFlight;

    await expect(verifyTokenVersion('u', 1, prisma)).resolves.toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('does not cache a row read while the whole cache was cleared', async () => {
    const { verifyTokenVersion, clearTokenVersionCache } = await load();
    const read = deferred<Row>();
    const { prisma, findUnique } = clientAnswering(read.promise, { tokenVersion: 1, isActive: false });

    const inFlight = verifyTokenVersion('u', 1, prisma);
    await vi.waitFor(() => expect(findUnique).toHaveBeenCalledTimes(1));
    clearTokenVersionCache();
    read.resolve({ tokenVersion: 1, isActive: true });
    await inFlight;

    await expect(verifyTokenVersion('u', 1, prisma)).resolves.toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('reads the cache entry after awaiting the TTL, so an invalidation during that wait counts', async () => {
    const { verifyTokenVersion, invalidateTokenVersionCache } = await load();
    // A 10-minute TTL keeps the entry valid past the 5-minute refresh of the TTL setting itself.
    ttlAnswer = async () => 600_000;
    const { prisma, findUnique } = clientAnswering({ tokenVersion: 1, isActive: true }, { tokenVersion: 2, isActive: true });
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    await expect(verifyTokenVersion('u', 1, prisma)).resolves.toBe(true); // cached: version 1

    clock.mockReturnValue(start + 5 * 60_000 + 1_000); // the TTL setting is due for a re-read
    const ttl = deferred<number>();
    ttlAnswer = () => ttl.promise;
    const inFlight = verifyTokenVersion('u', 1, prisma);
    invalidateTokenVersionCache('u'); // lands while the call waits for the TTL
    ttl.resolve(600_000);

    await expect(inFlight).resolves.toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(2);
    clock.mockRestore();
  });

  it('keeps the newer row when an older read finishes last after an invalidation', async () => {
    const { verifyTokenVersion, invalidateTokenVersionCache } = await load();
    const older = deferred<Row>();
    const { prisma, findUnique } = clientAnswering(older.promise, { tokenVersion: 2, isActive: true });

    const first = verifyTokenVersion('u', 1, prisma); // reads before the revocation
    await vi.waitFor(() => expect(findUnique).toHaveBeenCalledTimes(1));
    invalidateTokenVersionCache('u');
    await expect(verifyTokenVersion('u', 2, prisma)).resolves.toBe(true); // reads after it: version 2, cached
    older.resolve({ tokenVersion: 1, isActive: true });
    await first;

    // The cache still holds version 2: the older read did not overwrite it.
    await expect(verifyTokenVersion('u', 1, prisma)).resolves.toBe(false);
    await expect(verifyTokenVersion('u', 2, prisma)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
