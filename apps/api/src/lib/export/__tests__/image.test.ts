/**
 * Regression tests for the OOM export hotfix (v2.0.0): row photos must be
 * downscaled server-side before being embedded in XLSX/PDF exports, otherwise
 * a handful of large original-size photos (up to the 50MB upload limit) is
 * enough to exhaust the API container's heap regardless of row count.
 */

import sharp from 'sharp';
import { describe, it, expect } from 'vitest';

import { resizeForEmbed } from '../image';

async function makePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png()
    .toBuffer();
}

describe('resizeForEmbed', () => {
  it('downscales a large image to fit within the target box', async () => {
    const large = await makePng(3000, 3000);

    const out = await resizeForEmbed(large, 340, 120);
    const meta = await sharp(out).metadata();

    expect(meta.width).toBeLessThanOrEqual(340);
    expect(meta.height).toBeLessThanOrEqual(120);
    expect(out.length).toBeLessThan(large.length);
  });

  it('does not upscale an image smaller than the target box', async () => {
    const small = await makePng(20, 10);

    const out = await resizeForEmbed(small, 340, 120);
    const meta = await sharp(out).metadata();

    expect(meta.width).toBe(20);
    expect(meta.height).toBe(10);
  });

  it('falls back to the original buffer when sharp cannot decode it', async () => {
    const notAnImage = Buffer.from('not an image');

    const out = await resizeForEmbed(notAnImage, 340, 120);

    expect(out).toBe(notAnImage);
  });
});
