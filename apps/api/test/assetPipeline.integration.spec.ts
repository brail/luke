/**
 * End-to-end test of the asset derivative pipeline against the real local storage
 * provider (a throwaway temp directory) and the real database — no mocks. The
 * brandLogo integration specs mock storage entirely, so they never exercise sharp
 * against a real image, the background worker, or cascade deletes; this file is
 * the one place that does.
 *
 * The WebP regression test is the direct verification for the v2.0.0 bug that
 * motivated this pipeline: `toDataUri`-style helpers returned `null` for `.webp`,
 * silently dropping any WebP row picture from every export.
 */

import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ingestImageAsset, readAssetBuffer } from '../src/services/asset.service';
import { resetStorageProvider } from '../src/storage';

import { seedLocalStorageConfig } from './helpers/storageTestHelper';
import { createContextForRole } from './helpers/testContext';

import type { Context } from '../src/lib/trpc';

let basePath: string;
let ctx: Context;

async function makePng(width: number, height: number, alpha = false): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 10, g: 20, b: 30, alpha: 0.5 } : { r: 200, g: 50, b: 50 },
    },
  }).png().toBuffer();
}

async function makeWebp(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 10, g: 200, b: 50 } },
  }).webp().toBuffer();
}

function fileParams(buf: Buffer, filename: string, mimetype: string) {
  return { filename, mimetype, stream: Readable.from(buf), size: buf.byteLength };
}

async function waitForReady(fileObjectId: string): Promise<void> {
  await expect.poll(async () => {
    const master = await ctx.prisma.fileObject.findUnique({ where: { id: fileObjectId } });
    return master?.derivativesStatus;
  }, { timeout: 5000 }).toBe('READY');
}

describe('asset pipeline (real storage, no mocks)', () => {
  beforeEach(async () => {
    basePath = await mkdtemp(join(tmpdir(), 'luke-asset-pipeline-'));
    ctx = await createContextForRole();
    await seedLocalStorageConfig(ctx.prisma, basePath);
  });

  afterEach(async () => {
    resetStorageProvider();
    // Some tests intentionally read a variant before the fire-and-forget background
    // worker (`enqueueDerivatives`) has produced it, so a write can still be landing
    // in `basePath` when cleanup starts here — `maxRetries` absorbs the resulting
    // transient ENOTEMPTY instead of failing the test on an unrelated race.
    await rm(basePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it('generates the sync thumb inline and the rest (card, export) in the background', async () => {
    const png = await makePng(1200, 900);

    const result = await ingestImageAsset(ctx, {
      kind: 'collection-row-picture',
      file: fileParams(png, 'photo.png', 'image/png'),
    });

    // Sync variant is available immediately, before any background work runs.
    expect(result.urls.thumb).toBeDefined();

    await waitForReady(result.fileObjectId);

    const variants = await ctx.prisma.fileObject.findMany({
      where: { parentId: result.fileObjectId },
      select: { variant: true, contentType: true },
    });
    expect(variants.map(v => v.variant).sort()).toEqual(['card', 'export', 'thumb']);
    // None of the generated variants upscaled or otherwise ballooned past the master's own dimensions.
    for (const v of variants) {
      expect(['image/webp', 'image/jpeg', 'image/png']).toContain(v.contentType);
    }
  });

  it('transcodes a WebP master to JPEG/PNG for the export variant (v2.0.0 regression)', async () => {
    const webp = await makeWebp(800, 600);

    const result = await ingestImageAsset(ctx, {
      kind: 'collection-row-picture',
      file: fileParams(webp, 'photo.webp', 'image/webp'),
    });

    await waitForReady(result.fileObjectId);

    const read = await readAssetBuffer(ctx.prisma, 'collection-row-pictures', result.key, 'export');

    expect(read).not.toBeNull();
    // The bug: a naive `toDataUri` keyed off the file extension returned null for
    // `.webp`, so the photo silently never appeared in the PDF/XLSX export. The
    // `export` variant must never be WebP — pdfmake/exceljs can't embed it.
    expect(read!.contentType).not.toBe('image/webp');
    expect(['image/jpeg', 'image/png']).toContain(read!.contentType);
  });

  it('falls back to the master when a variant is not ready yet, without failing the read', async () => {
    const png = await makePng(400, 300);

    const result = await ingestImageAsset(ctx, {
      kind: 'brand-logo',
      file: fileParams(png, 'logo.png', 'image/png'),
    });

    // Read immediately — before the fire-and-forget worker has necessarily produced
    // the 'card' variant for a brand logo (only 'thumb' is generated synchronously).
    const read = await readAssetBuffer(ctx.prisma, 'brand-logos', result.key, 'card');

    expect(read).not.toBeNull();
    expect(read!.buffer.byteLength).toBeGreaterThan(0);
  });

  it('cascades derivative rows (DB) when the master FileObject is deleted', async () => {
    const png = await makePng(500, 500);

    const result = await ingestImageAsset(ctx, {
      kind: 'collection-row-picture',
      file: fileParams(png, 'photo.png', 'image/png'),
    });
    await waitForReady(result.fileObjectId);

    await ctx.prisma.fileObject.delete({ where: { id: result.fileObjectId } });

    const remaining = await ctx.prisma.fileObject.findMany({ where: { parentId: result.fileObjectId } });
    expect(remaining).toHaveLength(0);
  });

  it('preserves transparency: an alpha-channel source gets a PNG export variant', async () => {
    const pngWithAlpha = await makePng(300, 300, true);

    const result = await ingestImageAsset(ctx, {
      kind: 'brand-logo',
      file: fileParams(pngWithAlpha, 'logo.png', 'image/png'),
    });
    await waitForReady(result.fileObjectId);

    const read = await readAssetBuffer(ctx.prisma, 'brand-logos', result.key, 'export');
    expect(read).not.toBeNull();
    expect(read!.contentType).toBe('image/png');
  });

  it('does not fail the upload when the source is not a real decodable image', async () => {
    const garbage = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from('not actually a png')]);

    const result = await ingestImageAsset(ctx, {
      kind: 'collection-row-picture',
      file: fileParams(garbage, 'fake.png', 'image/png'),
    });

    expect(result.fileObjectId).toBeDefined();
    expect(result.urls.thumb).toBeUndefined();

    await expect.poll(async () => {
      const master = await ctx.prisma.fileObject.findUnique({ where: { id: result.fileObjectId } });
      return master?.derivativesStatus;
    }, { timeout: 5000 }).toBe('FAILED');

    // The read path still serves the (undecoded) master rather than erroring.
    const read = await readAssetBuffer(ctx.prisma, 'collection-row-pictures', result.key, 'export');
    expect(read).not.toBeNull();
  });
});
