/**
 * `processMaster` is the state machine at the center of the derivative pipeline:
 * every branch here decides whether a master image ever gets its thumb/card/export
 * variants, and whether a failure is retried, ignored as a benign race, or given up
 * on permanently. A wrong branch doesn't crash — it silently leaves an image
 * without previews, or spins forever re-processing a bucket that will never have
 * variants. `enqueueDerivatives`'s concurrency cap is the other half: the OOM class
 * this whole pipeline exists to fix (see `resizeForEmbed`'s v2.0.0 regression
 * tests) recurring on the one path that has no bound of its own otherwise.
 *
 * Storage, config, and pipeline are all mocked: this is unit-tier logic (no
 * assertion here needs a real Postgres row), and mocking lets every branch —
 * including races and permanent failures that would be slow or awkward to force
 * through a real filesystem — be exercised directly and deterministically.
 */

import { Prisma } from '@prisma/client';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { APP_CONFIG_DEFAULTS } from '@luke/core';

import { putDerivativeObject, readFileBuffer } from '../../../storage';
import { getConfigOrDefault } from '../../configManager';
import { enqueueDerivatives, processMaster, registerDerivativeScheduler } from '../derivativeWorker';
import { deriveVariant, probeHasAlpha } from '../pipeline';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

// `vi.mock` calls are hoisted above every import in this file regardless of where
// they're written textually — kept below the imports so eslint's import-x/first
// doesn't flag them, same effect either way.
vi.mock('../../../storage', () => ({
  putDerivativeObject: vi.fn(),
  readFileBuffer: vi.fn(),
}));
vi.mock('../../configManager', () => ({
  getConfigOrDefault: vi.fn(),
}));
vi.mock('../../schedulerLock', () => ({
  // Pass-through: the lock's own acquire/release semantics aren't this file's
  // concern, and requiring a real `scheduler_locks` row would make this an
  // integration test for no benefit — `withSchedulerLock` itself is exercised
  // by whichever scheduler test actually needs the lock's behavior.
  withSchedulerLock: (_prisma: unknown, _name: unknown, tick: () => Promise<unknown>) => tick,
}));
vi.mock('../pipeline', () => ({
  deriveVariant: vi.fn(),
  probeHasAlpha: vi.fn(),
}));

/** Mirrors the private constants in `derivativeWorker.ts` — not exported, so pinned here for the assertions that depend on their exact values. */
const MAX_DERIVATIVE_ATTEMPTS = 5;
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

function makeMaster(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'master-1',
    bucket: 'collection-row-pictures',
    key: '2026/08/26/uuid.png',
    parentId: null,
    width: 800,
    height: 600,
    derivativeAttempts: 0,
    createdBy: 'user-1',
    confirmedAt: new Date('2026-08-26T00:00:00Z'),
    ...overrides,
  };
}

/**
 * `markAttemptFailed` now does an atomic `{ increment: 1 }` (read-then-write would
 * lose a concurrent increment — `enqueueDerivatives` runs several masters in
 * parallel, and a tick can overlap with it). The generic `update` mock can't do
 * arithmetic on its own, so tests that exercise this path wire it to echo back
 * `currentAttempts + 1` for the increment call specifically.
 */
function mockAttemptIncrement(prisma: PrismaClient, currentAttempts: number): void {
  vi.mocked(prisma.fileObject.update).mockImplementation((async (args: unknown) => {
    const data = (args as { data?: Record<string, unknown> })?.data;
    const attempts = data?.derivativeAttempts;
    if (attempts && typeof attempts === 'object' && 'increment' in attempts) {
      return { derivativeAttempts: currentAttempts + 1 } as never;
    }
    return {} as never;
  }) as unknown as typeof prisma.fileObject.update);
}

function makePrisma() {
  return {
    fileObject: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as PrismaClient;
}

describe('processMaster', () => {
  let prisma: PrismaClient;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = makePrisma();
    vi.mocked(getConfigOrDefault).mockResolvedValue(true); // storage.derivatives.enabled
  });

  it('does nothing when the kill switch is off', async () => {
    vi.mocked(getConfigOrDefault).mockResolvedValue(false);

    await processMaster(prisma, 'master-1');

    expect(prisma.fileObject.findUnique).not.toHaveBeenCalled();
  });

  it('treats a missing AppConfig row for the kill switch as enabled (fail-open to the existing behavior, not fail-closed)', async () => {
    // The absent row no longer reaches this function: `getConfigOrDefault` resolves it against
    // `APP_CONFIG_DEFAULTS`, so what used to be a hand-written `raw === null ? true : …` here is
    // now a declaration. Asserting the declaration is what keeps the fail-open guarantee pinned.
    expect(APP_CONFIG_DEFAULTS['storage.derivatives.enabled']).toBe('true');
    vi.mocked(getConfigOrDefault).mockResolvedValue(true);
    vi.mocked(prisma.fileObject.findUnique).mockResolvedValue(null);

    await processMaster(prisma, 'master-1');

    // Reaching the findUnique call proves the kill switch check did not short-circuit.
    expect(prisma.fileObject.findUnique).toHaveBeenCalled();
  });

  it('does nothing when the master row no longer exists', async () => {
    vi.mocked(prisma.fileObject.findUnique).mockResolvedValue(null);

    await processMaster(prisma, 'gone');

    expect(prisma.fileObject.update).not.toHaveBeenCalled();
  });

  it('does nothing when the id refers to a derivative, not a master', async () => {
    vi.mocked(prisma.fileObject.findUnique).mockResolvedValue(makeMaster({ parentId: 'some-master' }) as never);

    await processMaster(prisma, 'derivative-1');

    expect(prisma.fileObject.update).not.toHaveBeenCalled();
  });

  it('marks a master in an unregistered bucket permanently FAILED instead of retrying it forever', async () => {
    // Every `FileObject` predating this pipeline (generic uploads/exports/assets/backups,
    // non-image) got `derivativesStatus = 'PENDING'` for free from the migration's
    // column default. Without this branch, the reconcile tick would re-select and
    // re-process one of these on every single tick, forever.
    vi.mocked(prisma.fileObject.findUnique).mockResolvedValue(makeMaster({ bucket: 'uploads' }) as never);

    await processMaster(prisma, 'master-1');

    expect(prisma.fileObject.update).toHaveBeenCalledWith({
      where: { id: 'master-1' },
      data: { derivativesStatus: 'FAILED', derivativeAttempts: MAX_DERIVATIVE_ATTEMPTS },
    });
    expect(prisma.fileObject.findMany).not.toHaveBeenCalled();
  });

  it('gives a null-width/height master (legacy pre-pipeline data) a genuine sharp attempt instead of an instant permanent failure', async () => {
    // Every `FileObject` predating this pipeline has null width/height (the migration
    // added the columns with no backfill) — that alone is not proof the image is
    // undecodable, so this must go through the normal missing-variant path, not the
    // unregistered-bucket-style instant fail.
    vi.mocked(prisma.fileObject.findUnique).mockResolvedValue(makeMaster({ width: null, height: null }) as never);
    vi.mocked(prisma.fileObject.findMany).mockResolvedValue([{ variant: 'thumb' }] as never); // card + export missing
    vi.mocked(readFileBuffer).mockResolvedValue(Buffer.from('master-bytes'));
    vi.mocked(probeHasAlpha).mockResolvedValue(false);
    vi.mocked(deriveVariant).mockResolvedValue({
      buffer: Buffer.from('variant-bytes'), contentType: 'image/webp', width: 400, height: 300,
    });

    await processMaster(prisma, 'master-1');

    expect(deriveVariant).toHaveBeenCalled();
    expect(prisma.fileObject.update).toHaveBeenCalledWith({
      where: { id: 'master-1' },
      data: { derivativesStatus: 'READY', derivativeAttempts: 0 },
    });
  });

  it('marks READY without touching sharp when every configured variant already exists', async () => {
    vi.mocked(prisma.fileObject.findUnique).mockResolvedValue(makeMaster() as never);
    // 'collection-row-picture' (bucket collection-row-pictures) configures thumb/card/export.
    vi.mocked(prisma.fileObject.findMany).mockResolvedValue([
      { variant: 'thumb' }, { variant: 'card' }, { variant: 'export' },
    ] as never);

    await processMaster(prisma, 'master-1');

    expect(prisma.fileObject.update).toHaveBeenCalledWith({
      where: { id: 'master-1' },
      data: { derivativesStatus: 'READY', derivativeAttempts: 0 },
    });
    expect(deriveVariant).not.toHaveBeenCalled();
  });

  it('generates every missing variant and marks READY on full success', async () => {
    vi.mocked(prisma.fileObject.findUnique).mockResolvedValue(makeMaster() as never);
    vi.mocked(prisma.fileObject.findMany).mockResolvedValue([{ variant: 'thumb' }] as never); // card + export missing
    vi.mocked(readFileBuffer).mockResolvedValue(Buffer.from('master-bytes'));
    vi.mocked(probeHasAlpha).mockResolvedValue(false);
    vi.mocked(deriveVariant).mockResolvedValue({
      buffer: Buffer.from('variant-bytes'), contentType: 'image/webp', width: 400, height: 300,
    });

    await processMaster(prisma, 'master-1');

    expect(deriveVariant).toHaveBeenCalledTimes(2); // card, export
    expect(putDerivativeObject).toHaveBeenCalledTimes(2);
    expect(putDerivativeObject).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ parentId: 'master-1', masterConfirmedAt: makeMaster().confirmedAt }),
    );
    expect(prisma.fileObject.update).toHaveBeenCalledWith({
      where: { id: 'master-1' },
      data: { derivativesStatus: 'READY', derivativeAttempts: 0 },
    });
  });

  it('treats a unique-constraint violation on a variant as an already-done race, not a failure', async () => {
    // A racing producer (the sync upload path, or another instance's reconcile tick)
    // may have just written the same deterministic key. That is success, not an error.
    vi.mocked(prisma.fileObject.findUnique).mockResolvedValue(makeMaster() as never);
    vi.mocked(prisma.fileObject.findMany).mockResolvedValue([{ variant: 'thumb' }, { variant: 'card' }] as never); // only export missing
    vi.mocked(readFileBuffer).mockResolvedValue(Buffer.from('master-bytes'));
    vi.mocked(probeHasAlpha).mockResolvedValue(false);
    vi.mocked(deriveVariant).mockResolvedValue({
      buffer: Buffer.from('variant-bytes'), contentType: 'image/jpeg', width: 400, height: 300,
    });
    vi.mocked(putDerivativeObject).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' }),
    );

    await processMaster(prisma, 'master-1');

    expect(prisma.fileObject.update).toHaveBeenCalledWith({
      where: { id: 'master-1' },
      data: { derivativesStatus: 'READY', derivativeAttempts: 0 },
    });
  });

  it('increments the attempt count and stays PENDING on a genuine variant failure below the retry ceiling', async () => {
    vi.mocked(prisma.fileObject.findUnique).mockResolvedValue(makeMaster({ derivativeAttempts: 1 }) as never);
    vi.mocked(prisma.fileObject.findMany).mockResolvedValue([{ variant: 'thumb' }, { variant: 'card' }] as never);
    vi.mocked(readFileBuffer).mockResolvedValue(Buffer.from('master-bytes'));
    vi.mocked(probeHasAlpha).mockResolvedValue(false);
    vi.mocked(deriveVariant).mockRejectedValue(new Error('sharp exploded'));
    mockAttemptIncrement(prisma, 1);

    await processMaster(prisma, 'master-1');

    expect(prisma.fileObject.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'master-1' },
      data: { derivativeAttempts: { increment: 1 } },
      select: { derivativeAttempts: true },
    });
    expect(prisma.fileObject.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'master-1' },
      data: { derivativesStatus: 'PENDING' },
    });
  });

  it('gives up permanently once the attempt count reaches the retry ceiling', async () => {
    vi.mocked(prisma.fileObject.findUnique).mockResolvedValue(
      makeMaster({ derivativeAttempts: MAX_DERIVATIVE_ATTEMPTS - 1 }) as never,
    );
    vi.mocked(prisma.fileObject.findMany).mockResolvedValue([{ variant: 'thumb' }, { variant: 'card' }] as never);
    vi.mocked(readFileBuffer).mockResolvedValue(Buffer.from('master-bytes'));
    vi.mocked(probeHasAlpha).mockResolvedValue(false);
    vi.mocked(deriveVariant).mockRejectedValue(new Error('sharp exploded'));
    mockAttemptIncrement(prisma, MAX_DERIVATIVE_ATTEMPTS - 1);

    await processMaster(prisma, 'master-1');

    expect(prisma.fileObject.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'master-1' },
      data: { derivativesStatus: 'FAILED' },
    });
  });

  it('counts a missing storage object as a failed attempt without calling sharp', async () => {
    vi.mocked(prisma.fileObject.findUnique).mockResolvedValue(makeMaster() as never);
    vi.mocked(prisma.fileObject.findMany).mockResolvedValue([{ variant: 'thumb' }] as never);
    vi.mocked(readFileBuffer).mockResolvedValue(null);
    mockAttemptIncrement(prisma, 0);

    await processMaster(prisma, 'master-1');

    expect(deriveVariant).not.toHaveBeenCalled();
    expect(prisma.fileObject.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'master-1' },
      data: { derivativesStatus: 'PENDING' },
    });
  });
});

describe('enqueueDerivatives concurrency cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bounds concurrent processMaster runs instead of letting a burst of uploads run unbounded', async () => {
    // getConfigOrDefault is processMaster's first await point (the kill-switch check) — resolving
    // it under an artificial delay turns it into an in-flight/peak-concurrency probe
    // without needing to fake the rest of the pipeline. Mirrors the same
    // inFlight/peak pattern already used for `IMAGE_FETCH_CONCURRENCY` in
    // `collectionLayout.export.pdf.service.test.ts`.
    let inFlight = 0;
    let peak = 0;
    vi.mocked(getConfigOrDefault).mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      return 'false'; // short-circuits processMaster right after this call
    });

    const prisma = makePrisma();
    const masterIds = Array.from({ length: 24 }, (_, i) => `master-${i}`);
    for (const id of masterIds) enqueueDerivatives(prisma, id);

    await expect.poll(() => vi.mocked(getConfigOrDefault).mock.calls.length, { timeout: 5000 }).toBe(masterIds.length);

    // The exact cap (8) is a private constant in derivativeWorker.ts; the invariant
    // this test protects is that it stays *bounded* well under the full burst size,
    // not the literal number — a future retune of the constant shouldn't break this.
    expect(peak).toBeLessThan(masterIds.length);
    expect(peak).toBeGreaterThan(1); // proves it's actually concurrent, not accidentally serialized to 1
  });
});

describe('registerDerivativeScheduler', () => {
  function makeFastify() {
    const hooks: Record<string, () => Promise<void> | void> = {};
    return {
      log: { info: vi.fn(), error: vi.fn() },
      addHook: vi.fn((name: string, fn: () => Promise<void> | void) => { hooks[name] = fn; }),
      __hooks: hooks,
    } as unknown as FastifyInstance & { __hooks: Record<string, () => Promise<void> | void> };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not let one master throwing during reconciliation stop the rest of the batch', async () => {
    // Same "try/catch per item" discipline as every other tick-based sweep in this
    // codebase (CLAUDE.md dev pattern #2) — a single bad master must not silently
    // swallow the whole 5-minute catch-up sweep for every other stale master.
    vi.mocked(getConfigOrDefault).mockResolvedValue(true);
    const prisma = makePrisma();
    vi.mocked(prisma.fileObject.findMany).mockImplementation(((args: unknown) => {
      const where = (args as { where?: Record<string, unknown> })?.where;
      // The reconcile query itself (parentId: null filter) vs. processMaster's own
      // "existing variants" lookup — distinguish by shape so this one mock serves both call sites.
      if (where && 'parentId' in where && where.parentId === null) {
        return Promise.resolve([{ id: 'bad-master' }, { id: 'good-master' }]);
      }
      return Promise.resolve([{ variant: 'thumb' }, { variant: 'card' }, { variant: 'export' }]);
    }) as unknown as typeof prisma.fileObject.findMany);
    vi.mocked(prisma.fileObject.findUnique).mockImplementation(((args: unknown) => {
      const id = (args as { where: { id: string } }).where.id;
      if (id === 'bad-master') return Promise.reject(new Error('DB blew up for this one row'));
      return Promise.resolve(makeMaster({ id }));
    }) as unknown as typeof prisma.fileObject.findUnique);

    const fastify = makeFastify();
    registerDerivativeScheduler(fastify, prisma);
    await fastify.__hooks.onReady?.();

    await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS);

    // The good master still got processed (marked READY) despite the bad one throwing.
    expect(prisma.fileObject.update).toHaveBeenCalledWith({
      where: { id: 'good-master' },
      data: { derivativesStatus: 'READY', derivativeAttempts: 0 },
    });
    expect(fastify.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ masterId: 'bad-master' }),
      expect.stringContaining('fallito'),
    );
  });

  it('skips the reconcile query entirely when the kill switch is off', async () => {
    vi.mocked(getConfigOrDefault).mockResolvedValue(false);
    const prisma = makePrisma();

    const fastify = makeFastify();
    registerDerivativeScheduler(fastify, prisma);
    await fastify.__hooks.onReady?.();
    await vi.advanceTimersByTimeAsync(RECONCILE_INTERVAL_MS);

    expect(prisma.fileObject.findMany).not.toHaveBeenCalled();
  });
});
