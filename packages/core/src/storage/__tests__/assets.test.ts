/**
 * `buildVariantKey`/`extensionForContentType` are the deterministic key-derivation
 * logic the whole asset pipeline depends on for idempotent retries (same master +
 * same content-type must always produce the same variant key, or a retry after a
 * partial failure would create a duplicate object instead of overwriting the same
 * one). `BUCKET_TO_ASSET_KIND` is the reverse lookup the background worker uses to
 * figure out which variants apply to a master it only knows by bucket.
 */

import { describe, it, expect } from 'vitest';

import {
  ASSET_KINDS,
  ASSET_KINDS_TUPLE,
  ASSET_PIPELINE_VERSION,
  BUCKET_TO_ASSET_KIND,
  buildVariantKey,
  extensionForContentType,
} from '../assets';

describe('extensionForContentType', () => {
  it.each([
    ['image/webp', 'webp'],
    ['image/png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/jpg', 'jpg'],
  ])('%s -> %s', (contentType, expected) => {
    expect(extensionForContentType(contentType)).toBe(expected);
  });

  it('falls back to a safe placeholder for an unrecognized content-type', () => {
    // The pipeline only ever produces webp/png/jpeg (see `deriveVariant`'s
    // `VariantOutputFormat`), so this branch should never fire in practice — but a
    // key-builder must not throw or produce an extension-less key for input it
    // doesn't recognize.
    expect(extensionForContentType('application/octet-stream')).toBe('bin');
  });
});

describe('buildVariantKey', () => {
  it('strips the master extension and appends the pipeline version and variant', () => {
    expect(buildVariantKey('2026/08/26/uuid.jpg', 'thumb', 'image/webp', 1))
      .toBe('2026/08/26/uuid/v1/thumb.webp');
  });

  it('defaults pipelineVersion to the current ASSET_PIPELINE_VERSION when omitted', () => {
    const key = buildVariantKey('2026/08/26/uuid.png', 'export', 'image/jpeg');
    expect(key).toBe(`2026/08/26/uuid/v${ASSET_PIPELINE_VERSION}/export.jpg`);
  });

  it('keeps the whole key intact when the master has no extension', () => {
    // `lastIndexOf('.')` returns -1 here; must not slice off the last path segment.
    expect(buildVariantKey('2026/08/26/uuid-no-ext', 'card', 'image/png', 2))
      .toBe('2026/08/26/uuid-no-ext/v2/card.png');
  });

  it('does not mistake a dot in a directory segment for a file extension', () => {
    // The dot in "2026.08" sits before the last "/" — `lastIndexOf('.') > lastIndexOf('/')`
    // must be false here, or the builder would corrupt the date-partitioned prefix
    // instead of only stripping a real trailing extension.
    expect(buildVariantKey('2026.08/26/uuid', 'thumb', 'image/webp', 1))
      .toBe('2026.08/26/uuid/v1/thumb.webp');
  });

  it('is deterministic: identical inputs always produce the identical key', () => {
    // The whole point of a derived (not random) key — a retry after a partial
    // failure must land on the exact same key, or `putDerivativeObject` creates a
    // duplicate row instead of the intended idempotent overwrite.
    const a = buildVariantKey('2026/08/26/uuid.jpg', 'export', 'image/jpeg', 3);
    const b = buildVariantKey('2026/08/26/uuid.jpg', 'export', 'image/jpeg', 3);
    expect(a).toBe(b);
  });
});

describe('BUCKET_TO_ASSET_KIND', () => {
  it('maps every registered bucket back to the kind that declares it', () => {
    for (const kind of ASSET_KINDS_TUPLE) {
      expect(BUCKET_TO_ASSET_KIND[ASSET_KINDS[kind].bucket]).toBe(kind);
    }
  });

  it('has exactly one entry per asset kind — no two kinds silently share a bucket', () => {
    // `Object.fromEntries` on a bucket collision would keep only the last kind and
    // silently drop the other; the worker would then apply the wrong kind's variant
    // set to every master in the dropped kind's bucket.
    expect(Object.keys(BUCKET_TO_ASSET_KIND)).toHaveLength(ASSET_KINDS_TUPLE.length);
  });
});
