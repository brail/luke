/**
 * @luke/core/storage/assets — Declarative registry for the image derivative pipeline.
 *
 * No dependency on `sharp` (or any Node-only module): this file is imported from
 * the browser too (upload dialogs read `ASSET_KINDS[...].maxSizeBytes` for
 * client-side pre-validation). The actual image processing lives in
 * `apps/api/src/lib/assets/pipeline.ts`.
 *
 * Adding a new asset type (a new upload path) is meant to cost exactly one entry
 * in `ASSET_KINDS` — not a new copy of validate/buffer/magic-bytes/putObject.
 */

import { z } from 'zod';

import type { StorageBucket } from './types.js';

/** Bump to force regeneration of every derivative (e.g. a preset's dimensions changed). */
export const ASSET_PIPELINE_VERSION = 1;

export const ASSET_VARIANTS_TUPLE = ['thumb', 'card', 'export'] as const;
export type AssetVariant = (typeof ASSET_VARIANTS_TUPLE)[number];
export const assetVariantSchema = z.enum(ASSET_VARIANTS_TUPLE);

export type VariantOutputFormat = 'webp' | 'auto';

export interface VariantSpec {
  /** Never upscales past this box — `fit: 'inside', withoutEnlargement: true`. */
  maxWidth: number;
  maxHeight: number;
  /**
   * 'auto' picks PNG when the source has an alpha channel, JPEG otherwise — used for
   * the `export` variant because pdfmake/exceljs (the PDF/XLSX embedders) don't
   * support WebP. 'webp' is used for UI-facing variants where both browsers and the
   * proxy route serve it directly.
   */
  format: VariantOutputFormat;
  quality: number;
}

/**
 * Preset dimensions are sized on the actual export consumers, not guessed:
 * PDF collection row (44x20pt), XLSX collection row (170x60px), row export
 * (120x90), row XLSX large photo (h 189px) — all well under 1600px at the
 * existing 2x oversample factor (`EMBED_OVERSAMPLE_FACTOR` in
 * apps/api/src/lib/export/image.ts).
 */
export const ASSET_VARIANTS: Record<AssetVariant, VariantSpec> = {
  thumb:  { maxWidth: 320,  maxHeight: 320,  format: 'webp', quality: 78 },
  card:   { maxWidth: 800,  maxHeight: 800,  format: 'webp', quality: 82 },
  export: { maxWidth: 1600, maxHeight: 1600, format: 'auto', quality: 85 },
};

export const ASSET_KINDS_TUPLE = [
  'collection-row-picture',
  'brand-logo',
  'company-asset',
  'specsheet-image',
] as const;
export type AssetKind = (typeof ASSET_KINDS_TUPLE)[number];
export const assetKindSchema = z.enum(ASSET_KINDS_TUPLE);

export interface AssetKindSpec {
  bucket: StorageBucket;
  allowedMimes: readonly string[];
  allowedExtensions: readonly string[];
  maxSizeBytes: number;
  /** Variants generated for this kind, beyond the always-generated sync one. */
  variants: readonly AssetVariant[];
  /** Generated synchronously in the upload request, for immediate preview. The rest are async. */
  syncVariant: AssetVariant;
}

const COMMON_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] as const;
const COMMON_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'] as const;

export const ASSET_KINDS: Record<AssetKind, AssetKindSpec> = {
  'collection-row-picture': {
    bucket: 'collection-row-pictures',
    allowedMimes: COMMON_IMAGE_MIMES,
    allowedExtensions: COMMON_IMAGE_EXTENSIONS,
    maxSizeBytes: 5 * 1024 * 1024,
    variants: ['thumb', 'card', 'export'],
    syncVariant: 'thumb',
  },
  'brand-logo': {
    bucket: 'brand-logos',
    allowedMimes: COMMON_IMAGE_MIMES,
    allowedExtensions: COMMON_IMAGE_EXTENSIONS,
    maxSizeBytes: 2 * 1024 * 1024,
    variants: ['thumb', 'export'],
    syncVariant: 'thumb',
  },
  'company-asset': {
    bucket: 'company-assets',
    allowedMimes: COMMON_IMAGE_MIMES,
    allowedExtensions: COMMON_IMAGE_EXTENSIONS,
    maxSizeBytes: 2 * 1024 * 1024,
    variants: ['thumb', 'export'],
    syncVariant: 'thumb',
  },
  'specsheet-image': {
    bucket: 'merchandising-specsheet-images',
    allowedMimes: COMMON_IMAGE_MIMES,
    allowedExtensions: COMMON_IMAGE_EXTENSIONS,
    maxSizeBytes: 10 * 1024 * 1024,
    variants: ['thumb', 'card', 'export'],
    syncVariant: 'thumb',
  },
};

/**
 * Reverse lookup, derived rather than hand-maintained: a `FileObject` row only stores
 * `bucket`, not which `AssetKind` produced it, so the derivative worker needs this to
 * know which variants apply to a given master it's processing.
 */
export const BUCKET_TO_ASSET_KIND: Partial<Record<StorageBucket, AssetKind>> = Object.fromEntries(
  (Object.entries(ASSET_KINDS) as [AssetKind, AssetKindSpec][]).map(([kind, spec]) => [spec.bucket, kind]),
);

/**
 * Every bucket that participates in the asset pipeline — as opposed to generic,
 * non-image buckets (`uploads`, `exports`, `assets`, `backups`) that share the
 * `FileObject` table but were never part of this feature. Scopes the derivative
 * worker's reconcile query and the backfill script to rows the pipeline actually
 * owns, instead of relying on every non-participating row getting individually
 * marked FAILED after being selected once.
 */
export const IMAGE_BUCKETS: readonly StorageBucket[] = Object.values(ASSET_KINDS).map(spec => spec.bucket);

/** Extension used in variant keys — 'export' is 'auto' format, so the real extension is only known after the pipeline decides PNG vs JPEG for a given source. */
export function extensionForContentType(contentType: string): string {
  switch (contentType) {
    case 'image/webp':
      return 'webp';
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    default:
      return 'bin';
  }
}

/**
 * Derives a variant's storage key from its master key — deterministic, so
 * regenerating (retry, backfill, pipeline version bump) is naturally idempotent.
 * `contentType` is the variant's actual output MIME (resolved by the pipeline,
 * since the 'export' preset's format is content-dependent — see `VariantOutputFormat`).
 *
 * @example
 * buildVariantKey('2026/08/26/uuid.jpg', 'thumb', 'image/webp', 1)
 * // → '2026/08/26/uuid/v1/thumb.webp'
 */
export function buildVariantKey(
  masterKey: string,
  variant: AssetVariant,
  contentType: string,
  pipelineVersion: number = ASSET_PIPELINE_VERSION,
): string {
  const lastDot = masterKey.lastIndexOf('.');
  const withoutExt = lastDot > masterKey.lastIndexOf('/') ? masterKey.slice(0, lastDot) : masterKey;
  const ext = extensionForContentType(contentType);
  return `${withoutExt}/v${pipelineVersion}/${variant}.${ext}`;
}
