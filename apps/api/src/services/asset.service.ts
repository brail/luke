/**
 * Single entry point for every image upload path (collection row pictures, brand/company
 * logos, specsheet images): validates, normalizes the master, generates the kind's
 * "sync" variant inline for immediate preview, and hands the rest off to the background
 * derivative worker. Adding a new upload path costs one entry in `ASSET_KINDS`
 * (`@luke/core`) — not a new copy of validate → buffer → magic-bytes → putObject.
 *
 * Read-side counterpart (`readAssetBuffer`) lives here too: it's the same registry,
 * the same fallback-to-master policy, read instead of written.
 */

import { Readable } from 'stream';

import { TRPCError } from '@trpc/server';

import {
  ASSET_KINDS,
  ASSET_PIPELINE_VERSION,
  ASSET_VARIANTS,
  buildVariantKey,
  type AssetKind,
  type AssetVariant,
  type StorageBucket,
} from '@luke/core';

import { derivativesEnabled, enqueueDerivatives, markPermanentlyFailed } from '../lib/assets/derivativeWorker';
import { deriveVariant, normalizeMaster } from '../lib/assets/pipeline';
import { bufferToDataUri } from '../lib/export/image';
import { streamToBuffer, validateImageFile, validateMagicBytes } from '../lib/imageUpload';
import { makeUrlResolver } from '../lib/storageUrl';
import { putDerivativeObject, putObject, readFileBuffer } from '../storage';

import type { Context } from '../lib/trpc';
import type { PrismaClient } from '@prisma/client';

type FileParams = {
  filename: string;
  mimetype: string;
  stream: NodeJS.ReadableStream;
  size: number;
};

export interface IngestImageAssetResult {
  fileObjectId: string;
  bucket: StorageBucket;
  key: string;
  /** Sanitized filename actually stored — callers use this for audit log entries. */
  originalName: string;
  publicUrl: string;
  /** URLs for whichever variants were generated synchronously (currently: `syncVariant` only, if the master decoded). */
  urls: Partial<Record<AssetVariant, string>>;
}

/**
 * Validates, normalizes, and stores a new master image, then generates the kind's
 * sync variant (immediate preview) inline. Never throws for a decode/derivation
 * failure past validation — an unprocessable photo must not fail the upload, it
 * just gets no preview until the background worker (or a human) sorts it out.
 *
 * Callers keep their own domain-specific audit log entry (targeting the Brand, the
 * CollectionLayoutRow, ...) — this function only covers the upload+pipeline
 * mechanics shared by every kind.
 */
export async function ingestImageAsset(
  ctx: Context,
  params: { kind: AssetKind; file: FileParams; pending?: boolean },
): Promise<IngestImageAssetResult> {
  const spec = ASSET_KINDS[params.kind];
  const sanitizedFilename = validateImageFile(params.file, spec);
  const rawBuffer = await streamToBuffer(params.file.stream);

  if (!validateMagicBytes(rawBuffer, params.file.mimetype)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'File corrotto o tipo non valido' });
  }

  const normalized = await normalizeMaster(rawBuffer, params.file.mimetype, ctx.logger);
  const masterConfirmedAt = params.pending ? null : new Date();

  const master = await putObject(ctx, {
    bucket: spec.bucket,
    originalName: sanitizedFilename,
    contentType: normalized.contentType,
    size: normalized.buffer.byteLength,
    stream: Readable.from(normalized.buffer),
    pending: params.pending,
    pipelineVersion: ASSET_PIPELINE_VERSION,
    width: normalized.width ?? undefined,
    height: normalized.height ?? undefined,
  });

  // Built once and reused for both URLs below — each call otherwise re-reads the
  // storage config from AppConfig independently, doubling that round trip for no reason.
  const resolve = await makeUrlResolver(ctx.prisma);
  const publicUrl = resolve(spec.bucket, master.key);
  const urls: Partial<Record<AssetVariant, string>> = {};

  if (!normalized.decoded) {
    ctx.logger?.warn(
      { fileObjectId: master.id, kind: params.kind },
      'asset pipeline: master did not decode as an image, skipping variant generation',
    );
    // A confirmed decode failure, not a guess — no background retry will succeed
    // against the same undecodable bytes, so mark it FAILED now instead of
    // leaving it PENDING for `enqueueDerivatives`/the reconcile tick to
    // rediscover the same failure via a wasted sharp attempt.
    await markPermanentlyFailed(ctx.prisma, master.id);
    return { fileObjectId: master.id, bucket: spec.bucket, key: master.key, originalName: sanitizedFilename, publicUrl, urls };
  }

  // Same kill switch `processMaster` checks — without this, the sync path would
  // keep generating variants while the background worker (and its own reconcile
  // tick) stand down, defeating the point of an instant, uniform off switch.
  if (await derivativesEnabled(ctx.prisma)) {
    try {
      const variantSpec = ASSET_VARIANTS[spec.syncVariant];
      const derived = await deriveVariant(normalized.buffer, normalized.hasAlpha, variantSpec);
      const variantKey = buildVariantKey(master.key, spec.syncVariant, derived.contentType, ASSET_PIPELINE_VERSION);

      await putDerivativeObject(ctx.prisma, {
        bucket: spec.bucket,
        key: variantKey,
        parentId: master.id,
        variant: spec.syncVariant,
        pipelineVersion: ASSET_PIPELINE_VERSION,
        contentType: derived.contentType,
        buffer: derived.buffer,
        width: derived.width,
        height: derived.height,
        createdBy: ctx.session?.user.id || 'system',
        masterConfirmedAt,
      });

      urls[spec.syncVariant] = resolve(spec.bucket, variantKey);
    } catch (err) {
      // Sync-path failure is not fatal: the background worker retries this exact
      // variant later (enqueueDerivatives below), same try/catch-per-item policy
      // as every batch job in this codebase — one bad derivative never blocks the upload.
      ctx.logger?.warn({ err, fileObjectId: master.id }, 'asset pipeline: sync variant generation failed');
    }
  }

  // Remaining variants (beyond the sync one) are generated out of the request path.
  enqueueDerivatives(ctx.prisma, master.id, ctx.logger);

  return {
    fileObjectId: master.id,
    bucket: spec.bucket,
    key: master.key,
    originalName: sanitizedFilename,
    publicUrl,
    urls,
  };
}

export interface ReadAssetBufferResult {
  buffer: Buffer;
  contentType: string;
  /** Pixel dimensions of the returned buffer, when known — null for a master that never decoded. Preserved through a further proportional resize (e.g. `resizeForEmbed`), so still valid for aspect-ratio math even if the caller shrinks the buffer further. */
  width: number | null;
  height: number | null;
}

/**
 * Reads a specific variant's bytes for a master identified by (bucket, key) — the
 * shape export services already have (`row.pictureKey`, `brand.logoKey`, ...).
 * Falls back to the master's own bytes/content-type when the variant doesn't exist
 * yet (not generated, pipeline disabled, or the master never decoded), and enqueues
 * background generation in that case so a later export benefits from it.
 *
 * Content-type comes from the resolved row's own `contentType` column — never
 * guessed from the key's file extension, which is what let a JPEG-declared PNG (or
 * a WebP silently invisible to `toDataUri`) reach export consumers before. Same for
 * `width`/`height`: read from the pipeline's own measurement, not hand-parsed from
 * PNG/JPEG headers by the caller.
 */
export async function readAssetBuffer(
  prisma: PrismaClient,
  bucket: StorageBucket,
  masterKey: string,
  variant: AssetVariant,
  logger?: { warn: (obj: object, msg: string) => void },
): Promise<ReadAssetBufferResult | null> {
  const master = await prisma.fileObject.findFirst({
    where: { bucket, key: masterKey, parentId: null },
    select: {
      id: true,
      contentType: true,
      width: true,
      height: true,
      // One query instead of a second `findFirst` keyed on `master.id`: the relation
      // already expresses "this variant, of this master", filtered and capped here.
      variants: {
        where: { variant, pipelineVersion: ASSET_PIPELINE_VERSION },
        select: { key: true, contentType: true, width: true, height: true },
        take: 1,
      },
    },
  });
  if (!master) {
    logger?.warn({ bucket, masterKey }, 'readAssetBuffer: master FileObject not found');
    return null;
  }

  const variantRow = master.variants[0];

  if (variantRow) {
    const buffer = await readFileBuffer(prisma, bucket, variantRow.key, logger);
    if (buffer) return { buffer, contentType: variantRow.contentType, width: variantRow.width, height: variantRow.height };
    // Row exists but the physical object is gone — fall through to the master.
  } else {
    enqueueDerivatives(prisma, master.id, logger);
  }

  const masterBuffer = await readFileBuffer(prisma, bucket, masterKey, logger);
  if (!masterBuffer) return null;

  // The `export` variant's whole point is guaranteeing non-WebP output for
  // consumers (pdfmake/exceljs) that can't embed WebP — see this function's own
  // doc comment. Falling back to a raw WebP master here (variant missing, kill
  // switch off, or still pending) would silently reproduce the exact v2.0.0 bug
  // this pipeline exists to fix — better no picture than a broken one.
  if (variant === 'export' && master.contentType === 'image/webp') return null;

  return { buffer: masterBuffer, contentType: master.contentType, width: master.width, height: master.height };
}

/**
 * Batch-resolves one variant's public URL for many masters at once, keyed by master
 * key. One query regardless of row count — for a list view (e.g. the collection
 * layout grid) resolving each row's variant individually would be N+1. A master key
 * with no matching variant row (not generated yet, or the master never decoded)
 * simply has no entry in the returned map — the caller falls back to the master's
 * own URL for those, same policy as `readAssetBuffer`.
 *
 * @param resolve - Pass an already-built resolver when a caller makes several
 *   `resolveVariantUrls` calls in one request (e.g. row pictures + brand logo for
 *   the same layout) — each fresh `makeUrlResolver` call otherwise re-reads the
 *   storage config from AppConfig. Built locally when omitted.
 */
export async function resolveVariantUrls(
  prisma: PrismaClient,
  bucket: StorageBucket,
  masterKeys: readonly string[],
  variant: AssetVariant,
  resolve?: (bucket: StorageBucket, key: string) => string,
): Promise<Map<string, string>> {
  if (masterKeys.length === 0) return new Map();

  const rows = await prisma.fileObject.findMany({
    where: {
      bucket,
      variant,
      pipelineVersion: ASSET_PIPELINE_VERSION,
      parent: { key: { in: masterKeys as string[] } },
    },
    select: { key: true, parent: { select: { key: true } } },
  });

  const resolveUrl = resolve ?? await makeUrlResolver(prisma);
  const urls = new Map<string, string>();
  for (const row of rows) {
    if (row.parent) urls.set(row.parent.key, resolveUrl(bucket, row.key));
  }
  return urls;
}

/**
 * Resolves a brand logo (by its `logoKey`, `null` when the brand has none) to a
 * data URI for embedding in a PDF/XLSX export — shared by the three export
 * builders that each embed the brand logo in their header. The `export` variant's
 * pipeline guarantees PNG or JPEG output, so this never needs the WebP-aware
 * guarding a naive extension-sniffing `toDataUri` would (the v2.0.0 bug this
 * whole pipeline exists to fix). Never throws: a storage/DB hiccup here must not
 * fail the export over a logo, so it degrades to no logo instead.
 */
export async function resolveLogoDataUri(
  prisma: PrismaClient,
  logoKey: string | null | undefined,
  logger?: { warn: (obj: object, msg: string) => void },
): Promise<string | null> {
  if (!logoKey) return null;
  try {
    const result = await readAssetBuffer(prisma, 'brand-logos', logoKey, 'export', logger);
    return result ? bufferToDataUri(result.buffer, result.contentType) : null;
  } catch (err) {
    logger?.warn({ err, logoKey }, 'resolveLogoDataUri: failed to resolve brand logo');
    return null;
  }
}
