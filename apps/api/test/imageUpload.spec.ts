/**
 * Tests for `sniffContentType` (apps/api/src/lib/imageUpload.ts).
 *
 * Unit tier: pure function, no DB. Uses the same magic-byte buffer helpers
 * as `validateMagicBytes`'s (untested, out of scope) real-world callers —
 * see test/helpers/storageTestHelper.ts.
 */

import { describe, it, expect } from 'vitest';

import { sniffContentType } from '../src/lib/imageUpload';

import {
  createValidPngBuffer,
  createValidJpegBuffer,
  createValidWebpBuffer,
  createInvalidImageBuffer,
} from './helpers';

describe('sniffContentType', () => {
  it('detects PNG from its magic bytes', () => {
    expect(sniffContentType(createValidPngBuffer())).toBe('image/png');
  });

  it('detects a JPEG variant that is not the first signature in the table (ffd8ffe1)', () => {
    // IMAGE_MAGIC_BYTES lists three JPEG signatures (ffd8ffe0/e1/e2); a naive
    // implementation that only checks the first would miss this one.
    const buffer = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
      Buffer.from('exif jpeg'),
    ]);
    expect(sniffContentType(buffer)).toBe('image/jpeg');
  });

  it('returns the canonical "image/jpeg", not "image/jpg", for JPEG bytes', () => {
    // Both keys share the same signature set in IMAGE_MAGIC_BYTES; the first
    // matching entry wins. Locking this so a future reordering of that table
    // doesn't silently flip which label gets written to FileObject.contentType.
    expect(sniffContentType(createValidJpegBuffer())).toBe('image/jpeg');
  });

  it('detects WebP from its RIFF container header', () => {
    expect(sniffContentType(createValidWebpBuffer())).toBe('image/webp');
  });

  it('returns null for bytes that match no known image signature', () => {
    expect(sniffContentType(createInvalidImageBuffer())).toBeNull();
  });

  it('returns null for a buffer shorter than the shortest magic-byte prefix', () => {
    // A zero-byte source file (or a stream that ends before any chunk arrives)
    // must not throw — migrate-storage.ts's tapFirstChunk/sniffFromProvider
    // can hand this an empty buffer.
    expect(sniffContentType(Buffer.alloc(0))).toBeNull();
  });
});
