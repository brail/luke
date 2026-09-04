/**
 * Regression tests for the single-row PDF/XLSX export OOM hotfix (v2.0.0):
 * large source photos must be downscaled before being embedded.
 */

import { randomBytes } from 'node:crypto';

import sharp from 'sharp';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { readAssetBuffer } from '../asset.service';
import { buildCollectionRowPdf, buildCollectionRowXlsx } from '../collectionLayout.export.row.service';

import type { CollectionRowForExport, RowExportContext } from '../collectionLayout.export.row.service';

vi.mock('../asset.service', () => ({
  readAssetBuffer: vi.fn(),
  // Every fixture in this file uses `logoKey: null`, which real `resolveLogoDataUri`
  // short-circuits to `null` without touching storage — this mock mirrors exactly
  // that, so it needs no per-test setup.
  resolveLogoDataUri: vi.fn().mockResolvedValue(null),
}));

const mockPrisma = {
  phase: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  companyProfile: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
} as unknown as PrismaClient;

function makeRow(pictureKey: string | null): CollectionRowForExport {
  return {
    id: 'row-1',
    collectionLayoutId: 'layout-1',
    groupId: 'group-1',
    order: 0,
    line: 'Line',
    article: null,
    gender: null,
    productCategory: null,
    strategy: null,
    status: null,
    styleStatus: null,
    phaseId: null,
    skuForecast: 10,
    qtyForecast: 100,
    designer: null,
    toolingQuotation: null,
    styleNotes: null,
    materialNotes: null,
    colorNotes: null,
    toolingNotes: null,
    pictureKey,
    createdAt: new Date(),
    updatedAt: new Date(),
    vendor: null,
    quotations: [],
  } as unknown as CollectionRowForExport;
}

function makeCtx(pictureKey: string | null): RowExportContext {
  return {
    brand: { name: 'Brand', code: 'BR', logoKey: null },
    season: { name: 'Season', code: 'S1', year: 2026 },
    row: makeRow(pictureKey),
  };
}

async function makeLargeJpeg(): Promise<Buffer> {
  return sharp(randomBytes(1500 * 1500 * 3), {
    raw: { width: 1500, height: 1500, channels: 3 },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe('buildCollectionRowPdf', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downscales a large source photo before embedding it (OOM regression)', async () => {
    const noise = await makeLargeJpeg();
    vi.mocked(readAssetBuffer).mockResolvedValue({ buffer: noise, contentType: 'image/jpeg', width: 1500, height: 1500 });

    const buffer = await buildCollectionRowPdf(makeCtx('huge.jpg'), mockPrisma, 'Tester', new Date());

    // The full-size source photo (base64-encoded into the content stream) must
    // not survive into the output PDF — a single large photo embedded at
    // original resolution can exhaust the container's heap on its own.
    expect(buffer.length).toBeLessThan(noise.length);
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('produces a valid non-empty PDF buffer when there is no photo (smoke test)', async () => {
    vi.mocked(readAssetBuffer).mockResolvedValue(null);

    const buffer = await buildCollectionRowPdf(makeCtx(null), mockPrisma, 'Tester', new Date());

    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });
});

describe('buildCollectionRowXlsx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downscales a large source photo before embedding it (OOM regression)', async () => {
    const noise = await makeLargeJpeg();
    vi.mocked(readAssetBuffer).mockResolvedValue({ buffer: noise, contentType: 'image/jpeg', width: 1500, height: 1500 });

    const buffer = await buildCollectionRowXlsx(makeCtx('huge.jpg'), mockPrisma);

    expect(buffer.length).toBeLessThan(noise.length);
  });

  it('produces a valid non-empty XLSX buffer when there is no photo (smoke test)', async () => {
    vi.mocked(readAssetBuffer).mockResolvedValue(null);

    const buffer = await buildCollectionRowXlsx(makeCtx(null), mockPrisma);

    expect(buffer.length).toBeGreaterThan(0);
  });
});
