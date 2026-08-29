/**
 * Pure image-processing functions for the asset derivative pipeline. No DB, no
 * storage, no `Context` — buffer in, buffer out, fully unit-testable without
 * infrastructure. Orchestration (which variants to generate, how to persist
 * them, retry policy) lives in `apps/api/src/services/asset.service.ts`.
 */

import sharp from 'sharp';

import type { VariantSpec } from '@luke/core';

type Logger = { warn: (obj: object, msg: string) => void };

/**
 * Decompression-bomb guard: a small compressed file can decode to an enormous
 * pixel buffer (e.g. a crafted PNG). ~100MP caps worst-case decoded size well
 * above any real photo while still bounding memory use per upload.
 */
const MAX_INPUT_PIXELS = 100_000_000;

const SHARP_INPUT_OPTS = {
  // Matches this pipeline's access pattern (decode once, transform, encode,
  // discard) — keeps libvips from buffering more of a large source than a
  // single linear pass needs. Same rationale as `resizeForEmbed`.
  sequentialRead: true,
  limitInputPixels: MAX_INPUT_PIXELS,
  // 'error' (not the stricter default 'warning'): real-world photos from phones
  // and image editors often carry minor, harmless format warnings that would
  // otherwise reject an upload that every browser renders fine.
  failOn: 'error',
} as const;

const FORMAT_TO_MIME: Record<string, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export interface NormalizedMaster {
  buffer: Buffer;
  contentType: string;
  width: number | null;
  height: number | null;
  hasAlpha: boolean;
  /** `false` when sharp could not decode the source — the other fields then describe the untouched original. */
  decoded: boolean;
}

/**
 * Normalizes an uploaded master image in place (same format, not transcoded):
 * bakes in EXIF orientation then discards it, converts to sRGB, and strips all
 * remaining metadata (GPS/EXIF — privacy, e.g. photos taken in a showroom).
 *
 * Never throws. A buffer that merely passed magic-byte sniffing but isn't a
 * real decodable image (fuzzed input, or a test fixture) falls back to the
 * original bytes untouched — an upload must never fail because normalization
 * couldn't run. Note this is the opposite of `resizeForEmbed`, which drops an
 * undecodable buffer instead of passing it on: keeping the bytes is safe here
 * (one upload, already size-capped) and unsafe there (many buffers held at once
 * across a whole export). See that function for the full rationale.
 */
export async function normalizeMaster(
  buf: Buffer,
  claimedContentType: string,
  logger?: Logger,
): Promise<NormalizedMaster> {
  try {
    const probe = sharp(buf, SHARP_INPUT_OPTS);
    const meta = await probe.metadata();
    const format = meta.format && meta.format in FORMAT_TO_MIME ? meta.format : null;
    if (!format) {
      throw new Error(`unsupported source format: ${meta.format ?? 'unknown'}`);
    }

    // .rotate() with no args reads the EXIF orientation tag and bakes it into
    // the pixel data. Not calling .withMetadata() afterwards is what actually
    // strips the tag (and GPS/EXIF) from the output — sharp omits all metadata
    // by default unless asked to keep it.
    let pipeline = sharp(buf, SHARP_INPUT_OPTS).rotate().toColorspace('srgb');
    pipeline = format === 'png' ? pipeline.png()
      : format === 'webp' ? pipeline.webp({ quality: 90 })
      : pipeline.jpeg({ quality: 92 });

    // `resolveWithObject` reads width/height off the same encode pass instead of
    // decoding the just-produced buffer a second time purely to measure it.
    // `hasAlpha` comes from the initial probe rather than a third decode: this
    // pipeline never changes format (png stays png, jpeg stays jpeg, webp stays
    // webp), so alpha support can't change between input and output either.
    const { data: buffer, info } = await pipeline.toBuffer({ resolveWithObject: true });

    return {
      buffer,
      contentType: FORMAT_TO_MIME[format],
      width: info.width ?? null,
      height: info.height ?? null,
      hasAlpha: meta.hasAlpha ?? false,
      decoded: true,
    };
  } catch (err) {
    logger?.warn({ err }, 'asset pipeline: master normalization failed, storing original buffer as-is');
    return {
      buffer: buf,
      contentType: claimedContentType,
      width: null,
      height: null,
      hasAlpha: false,
      decoded: false,
    };
  }
}

export interface DerivedVariant {
  buffer: Buffer;
  contentType: string;
  width: number | null;
  height: number | null;
}

/**
 * Produces one derivative from an already-normalized master buffer. Never
 * upscales (`withoutEnlargement: true`). For `format: 'auto'` presets (the
 * `export` variant), picks PNG when the source has an alpha channel — so a
 * logo keeps its transparency — JPEG otherwise, because pdfmake/exceljs (the
 * PDF/XLSX embedders) don't support WebP at all.
 *
 * Can throw (an already-normalized master should always decode, but a
 * transform step can still fail on pathological input) — the caller decides
 * the retry/fallback policy, this function stays a pure transform.
 */
export async function deriveVariant(
  normalizedMasterBuf: Buffer,
  masterHasAlpha: boolean,
  spec: VariantSpec,
): Promise<DerivedVariant> {
  const resized = sharp(normalizedMasterBuf, SHARP_INPUT_OPTS)
    .resize({ width: spec.maxWidth, height: spec.maxHeight, fit: 'inside', withoutEnlargement: true });

  const outFormat = spec.format === 'webp' ? 'webp' : masterHasAlpha ? 'png' : 'jpeg';
  const encoded = outFormat === 'webp' ? resized.webp({ quality: spec.quality })
    : outFormat === 'png' ? resized.png()
    : resized.jpeg({ quality: spec.quality });

  // Same encode pass reports width/height — no need for a second decode of the
  // buffer this call just produced purely to measure it.
  const { data: buffer, info } = await encoded.toBuffer({ resolveWithObject: true });

  return {
    buffer,
    contentType: FORMAT_TO_MIME[outFormat],
    width: info.width ?? null,
    height: info.height ?? null,
  };
}

/**
 * Probes whether a buffer decodes to an image with an alpha channel. Used by the
 * background derivative worker, which only has the already-normalized master bytes
 * read back from storage — `hasAlpha` itself isn't persisted, since it's cheap to
 * re-probe and would otherwise need a schema column used by nothing else.
 */
export async function probeHasAlpha(buf: Buffer): Promise<boolean> {
  try {
    const meta = await sharp(buf, SHARP_INPUT_OPTS).metadata();
    return meta.hasAlpha ?? false;
  } catch {
    return false;
  }
}
