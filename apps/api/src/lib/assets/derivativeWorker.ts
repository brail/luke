/**
 * Background generation of image derivatives (thumb/card/export) beyond the one
 * generated synchronously at upload time (`asset.service.ts`'s `ingestImageAsset`).
 *
 * Two entry points:
 * - `enqueueDerivatives(prisma, masterId)` — fire-and-forget, called right after an
 *   upload so the remaining variants show up moments later without blocking the
 *   response. Same `setImmediate` idiom already used for old-logo cleanup in
 *   `brandLogo.service.ts`.
 * - `registerDerivativeScheduler` — periodic reconciliation tick (every 5 min) that
 *   picks up whatever the immediate path missed: a crashed process, a variant that
 *   failed and needs a retry, or a backfilled master (`scripts/backfill-asset-derivatives.ts`).
 *   Sequential per-master processing with individual try/catch, same shape as every
 *   other tick-based sweep in this directory (`retryFailedCleanups`, `checkFeedback`) —
 *   already safe (concurrency 1), no separate cap needed there.
 *
 * `enqueueDerivatives` is the one that needs a cap: it fires once per upload, and a
 * burst of concurrent uploads would otherwise spawn unbounded parallel sharp work —
 * the exact OOM class this pipeline exists to fix (see `resizeForEmbed`'s v2.0.0
 * regression tests). Bounded via `p-limit`, mirroring `IMAGE_FETCH_CONCURRENCY` in
 * `lib/export/concurrency.ts`.
 */

import { Prisma } from '@prisma/client';
import pLimit from 'p-limit';

import {
  ASSET_KINDS,
  ASSET_PIPELINE_VERSION,
  ASSET_VARIANTS,
  BUCKET_TO_ASSET_KIND,
  buildVariantKey,
  IMAGE_BUCKETS,
  type AssetVariant,
  type StorageBucket,
} from '@luke/core';

import { putDerivativeObject, readFileBuffer } from '../../storage';
import { getConfig } from '../configManager';
import { withSchedulerLock } from '../schedulerLock';

import { deriveVariant, probeHasAlpha } from './pipeline';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

type Logger = { warn: (obj: object, msg: string) => void; error?: (obj: object, msg: string) => void };

/** After this many failed attempts, the reconcile tick stops retrying a master and leaves it FAILED for a human to look at. */
const MAX_DERIVATIVE_ATTEMPTS = 5;
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
/** Bounds one tick's work; the remainder is picked up on the next tick — same shape as `MAX_ROWS_PER_TICK` in `retentionScheduler.ts`. */
const RECONCILE_BATCH_LIMIT = 200;
/** Max concurrent `processMaster` runs from the immediate upload path — same rationale and value as `IMAGE_FETCH_CONCURRENCY`. */
const DERIVATIVE_CONCURRENCY = 8;
const derivativeLimit = pLimit(DERIVATIVE_CONCURRENCY);

/** Exported for `asset.service.ts`'s `ingestImageAsset`, whose synchronous sync-variant generation must honor the same kill switch — see the call site there for why. */
export async function derivativesEnabled(prisma: PrismaClient): Promise<boolean> {
  const raw = await getConfig(prisma, 'storage.derivatives.enabled', false);
  return raw === null ? true : raw === 'true';
}

function isUniqueConstraintViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Generates whatever variants are missing for one master. Idempotent: a variant
 * whose deterministic key already exists (written by a racing call — the sync
 * path, or another instance's reconcile tick) is treated as already done, not
 * a failure.
 *
 * Exported for `scripts/backfill-asset-derivatives.ts`, which drives this directly
 * instead of waiting on the 5-minute reconcile tick — same function, no parallel
 * reimplementation of the pipeline.
 */
export async function processMaster(prisma: PrismaClient, masterId: string, logger?: Logger): Promise<void> {
  // Checked here, not only in `reconcileTick`: `enqueueDerivatives` fires from every
  // upload regardless of the tick, and the kill switch must stop derivative
  // generation entirely, not just the periodic catch-up sweep. Leaves
  // `derivativesStatus` untouched (still PENDING) so re-enabling it later plus the
  // next reconcile tick picks the master back up.
  if (!(await derivativesEnabled(prisma))) return;

  const master = await prisma.fileObject.findUnique({ where: { id: masterId } });
  if (!master || master.parentId !== null) return;

  const kind = BUCKET_TO_ASSET_KIND[master.bucket as StorageBucket];
  if (!kind) {
    // Every `FileObject` predating this pipeline (generic `uploads`/`exports`/`assets`/
    // `backups` rows, non-image) got `derivativesStatus = 'PENDING'` for free from the
    // migration's column default. Without marking these terminal, the reconcile tick's
    // `WHERE derivativesStatus IN (PENDING, FAILED)` would re-select and re-log every
    // one of them, forever, on every 5-minute tick. `reconcileTick` also scopes its
    // query to `IMAGE_BUCKETS` so this branch shouldn't normally be reached from
    // there — it's a safety net for a direct `enqueueDerivatives`/backfill call.
    await markPermanentlyFailed(prisma, masterId);
    return;
  }
  const spec = ASSET_KINDS[kind];

  // Null width/height alone is NOT proof of an undecodable source: every legacy
  // `FileObject` predating this pipeline has null width/height too (the migration
  // added the columns with no backfill), and those are legitimate images that
  // deserve a real sharp attempt. An undecodable master fails naturally below
  // (`readFileBuffer`/`deriveVariant` throwing) and is retried up to
  // `MAX_DERIVATIVE_ATTEMPTS` like any other failure — no separate fast-fail path.
  const existing = await prisma.fileObject.findMany({
    where: { parentId: masterId, pipelineVersion: ASSET_PIPELINE_VERSION },
    select: { variant: true },
  });
  const existingVariants = new Set(existing.map(e => e.variant));
  const missing = spec.variants.filter(v => !existingVariants.has(v));

  if (missing.length === 0) {
    await markReady(prisma, masterId);
    return;
  }

  const masterBuffer = await readFileBuffer(prisma, master.bucket as StorageBucket, master.key, logger);
  if (!masterBuffer) {
    logger?.warn({ masterId }, 'asset derivative worker: master object missing from storage');
    await markAttemptFailed(prisma, masterId);
    return;
  }

  const hasAlpha = await probeHasAlpha(masterBuffer);

  // Re-read rather than reuse `master.confirmedAt` captured above: the sharp work
  // above (readFileBuffer, probeHasAlpha) is enough time for `confirmPendingFile` to
  // confirm this master in between, and a derivative written after that point must
  // carry the fresh value, not the stale "still pending" one read before it happened.
  const freshMaster = await prisma.fileObject.findUnique({ where: { id: masterId }, select: { confirmedAt: true } });
  const currentConfirmedAt = freshMaster?.confirmedAt ?? master.confirmedAt;

  // Each variant has its own deterministic key (`buildVariantKey` includes the
  // variant name) and both read `masterBuffer`/`hasAlpha` only — no shared mutable
  // state, so generating them concurrently is safe and turns one master's
  // wall-time from the sum of its variants to the slowest one.
  const results = await Promise.allSettled(missing.map(async variant => {
    const variantSpec = ASSET_VARIANTS[variant as AssetVariant];
    const derived = await deriveVariant(masterBuffer, hasAlpha, variantSpec);
    const key = buildVariantKey(master.key, variant as AssetVariant, derived.contentType, ASSET_PIPELINE_VERSION);

    try {
      await putDerivativeObject(prisma, {
        bucket: master.bucket as StorageBucket,
        key,
        parentId: masterId,
        variant,
        pipelineVersion: ASSET_PIPELINE_VERSION,
        contentType: derived.contentType,
        buffer: derived.buffer,
        width: derived.width,
        height: derived.height,
        createdBy: master.createdBy,
        masterConfirmedAt: currentConfirmedAt,
      });
    } catch (err) {
      if (isUniqueConstraintViolation(err)) return; // already written by a racing producer — not a failure
      throw err;
    }
  }));

  let anyFailed = false;
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      anyFailed = true;
      logger?.warn({ err: result.reason, masterId, variant: missing[i] }, 'asset derivative worker: variant generation failed');
    }
  });

  if (anyFailed) {
    await markAttemptFailed(prisma, masterId);
  } else {
    await markReady(prisma, masterId);
  }
}

/**
 * Exported for `asset.service.ts`'s `ingestImageAsset`: when `normalizeMaster`
 * itself couldn't decode the source, that IS a real, already-confirmed decode
 * failure (not the width/height-null heuristic this file used to rely on, which
 * false-positived on every legacy pre-pipeline row). No point enqueueing a
 * background retry that will fail the exact same way — mark it FAILED right there.
 */
export async function markPermanentlyFailed(prisma: PrismaClient, masterId: string): Promise<void> {
  await prisma.fileObject.update({
    where: { id: masterId },
    data: { derivativesStatus: 'FAILED', derivativeAttempts: MAX_DERIVATIVE_ATTEMPTS },
  });
}

async function markReady(prisma: PrismaClient, masterId: string): Promise<void> {
  await prisma.fileObject.update({
    where: { id: masterId },
    data: { derivativesStatus: 'READY', derivativeAttempts: 0 },
  });
}

// Atomic increment, not read-then-write: `enqueueDerivatives` runs up to
// `DERIVATIVE_CONCURRENCY` masters in parallel plus a concurrent reconcile tick,
// so a stale in-memory `derivativeAttempts` read at the top of `processMaster`
// could lose a concurrent increment (two failures landing as one).
async function markAttemptFailed(prisma: PrismaClient, masterId: string): Promise<void> {
  const updated = await prisma.fileObject.update({
    where: { id: masterId },
    data: { derivativeAttempts: { increment: 1 } },
    select: { derivativeAttempts: true },
  });
  await prisma.fileObject.update({
    where: { id: masterId },
    data: { derivativesStatus: updated.derivativeAttempts >= MAX_DERIVATIVE_ATTEMPTS ? 'FAILED' : 'PENDING' },
  });
}

/**
 * Schedules background generation of a master's remaining variants. Fire-and-forget
 * by design — the caller (an upload request, or a read that found a variant
 * missing) must not wait on this. Queued through `derivativeLimit` rather than run
 * immediately: `setImmediate` alone only defers the *start*, not the concurrency —
 * a burst of uploads would otherwise all begin `processMaster` (and its sharp work)
 * in the same tick.
 */
export function enqueueDerivatives(prisma: PrismaClient, masterId: string, logger?: Logger): void {
  setImmediate(() => {
    derivativeLimit(() => processMaster(prisma, masterId, logger)).catch(err => {
      logger?.error?.({ err, masterId }, 'asset derivative worker: unhandled error processing master');
    });
  });
}

async function reconcileTick(prisma: PrismaClient, logger: FastifyInstance['log']): Promise<void> {
  if (!(await derivativesEnabled(prisma))) return;

  const stale = await prisma.fileObject.findMany({
    where: {
      parentId: null,
      bucket: { in: IMAGE_BUCKETS as string[] },
      OR: [
        { derivativesStatus: { in: ['PENDING', 'FAILED'] }, derivativeAttempts: { lt: MAX_DERIVATIVE_ATTEMPTS } },
        // READY masters whose variants were produced under an older pipeline
        // version: bumping `ASSET_PIPELINE_VERSION` needs a trigger that finds
        // these somewhere, and this is it. `processMaster`'s own "existing"
        // query already filters variants by the *current* version, so it
        // naturally treats these as fully missing and regenerates them.
        { derivativesStatus: 'READY', variants: { some: { pipelineVersion: { not: ASSET_PIPELINE_VERSION } } } },
      ],
    },
    take: RECONCILE_BATCH_LIMIT,
    select: { id: true },
  });

  for (const { id } of stale) {
    try {
      await processMaster(prisma, id, logger);
    } catch (err) {
      logger.error({ err, masterId: id }, 'Asset derivative reconcile: tick fallito per un master');
    }
  }
}

/**
 * Registers the periodic reconciliation tick as a Fastify plugin (`onReady`/`onClose`),
 * same pattern as the other tick-based schedulers (`retentionScheduler`, `feedbackSyncScheduler`).
 */
export function registerDerivativeScheduler(fastify: FastifyInstance, prisma: PrismaClient): void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const lockedTick = withSchedulerLock(prisma, 'asset-derivatives', () => reconcileTick(prisma, fastify.log));
  const run = () =>
    lockedTick().catch(err =>
      fastify.log.error({ err }, 'Asset derivative reconcile: errore non gestito')
    );

  fastify.addHook('onReady', async () => {
    fastify.log.info('Asset derivative reconcile: avviato (tick ogni 5 min)');
    timer = setInterval(() => void run(), RECONCILE_INTERVAL_MS);
  });

  fastify.addHook('onClose', async () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    fastify.log.info('Asset derivative reconcile: fermato');
  });
}
