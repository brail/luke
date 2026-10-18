import sharp from 'sharp';
import { describe, it, expect } from 'vitest';

import { ASSET_VARIANTS } from '@luke/core';

import { normalizeMaster, deriveVariant } from '../pipeline';

async function makeRgb(width: number, height: number, alpha = false): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 10, g: 20, b: 30, alpha: 0.5 } : { r: 200, g: 100, b: 50 },
    },
  }).png().toBuffer();
}

describe('normalizeMaster', () => {
  it('bakes in EXIF orientation and strips it from the output', async () => {
    // Wide source (40x20) tagged as rotated 90deg (orientation 6): auto-orient
    // must swap the dimensions in the output, proving the tag was actually applied.
    const wide = await sharp({
      create: { width: 40, height: 20, channels: 3, background: { r: 255, g: 0, b: 0 } },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const result = await normalizeMaster(wide, 'image/jpeg');

    expect(result.decoded).toBe(true);
    expect(result.width).toBe(20);
    expect(result.height).toBe(40);

    const outMeta = await sharp(result.buffer).metadata();
    expect(outMeta.orientation).toBeUndefined();
    expect(outMeta.exif).toBeUndefined();
  });

  it('preserves the source format (PNG stays PNG)', async () => {
    const png = await makeRgb(50, 50);
    const result = await normalizeMaster(png, 'image/png');

    expect(result.decoded).toBe(true);
    expect(result.contentType).toBe('image/png');
  });

  it('reports hasAlpha for a source with a transparency channel', async () => {
    const withAlpha = await makeRgb(30, 30, true);
    const result = await normalizeMaster(withAlpha, 'image/png');

    expect(result.decoded).toBe(true);
    expect(result.hasAlpha).toBe(true);
  });

  it('falls back to the original buffer when sharp cannot decode it', async () => {
    const notAnImage = Buffer.from('not an image, just magic bytes: \x89PNG');

    const result = await normalizeMaster(notAnImage, 'image/png');

    expect(result.decoded).toBe(false);
    expect(result.buffer).toBe(notAnImage);
    expect(result.contentType).toBe('image/png');
    expect(result.width).toBeNull();
  });
});

describe('deriveVariant', () => {
  it('downscales to fit inside the preset box without distortion', async () => {
    const large = await makeRgb(3000, 1500);

    const out = await deriveVariant(large, false, ASSET_VARIANTS.export);
    const meta = await sharp(out.buffer).metadata();

    expect(meta.width).toBeLessThanOrEqual(ASSET_VARIANTS.export.maxWidth);
    expect(meta.height).toBeLessThanOrEqual(ASSET_VARIANTS.export.maxHeight);
  });

  it('never upscales a source smaller than the preset box', async () => {
    const small = await makeRgb(50, 30);

    const out = await deriveVariant(small, false, ASSET_VARIANTS.thumb);
    const meta = await sharp(out.buffer).metadata();

    expect(meta.width).toBe(50);
    expect(meta.height).toBe(30);
  });

  it("'export' preset picks PNG for a source with alpha (preserves transparency)", async () => {
    const withAlpha = await makeRgb(100, 100, true);

    const out = await deriveVariant(withAlpha, true, ASSET_VARIANTS.export);

    expect(out.contentType).toBe('image/png');
    const meta = await sharp(out.buffer).metadata();
    expect(meta.hasAlpha).toBe(true);
  });

  it("'export' preset picks JPEG for a source without alpha (pdfmake/exceljs can't embed WebP)", async () => {
    const opaque = await makeRgb(100, 100, false);

    const out = await deriveVariant(opaque, false, ASSET_VARIANTS.export);

    expect(out.contentType).toBe('image/jpeg');
  });

  it("'thumb'/'card' presets always produce WebP regardless of alpha", async () => {
    const opaque = await makeRgb(100, 100, false);

    const out = await deriveVariant(opaque, false, ASSET_VARIANTS.thumb);

    expect(out.contentType).toBe('image/webp');
  });
});
