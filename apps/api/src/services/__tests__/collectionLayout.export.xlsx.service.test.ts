/**
 * Regression tests for the XLSX export OOM hotfix (v2.0.0):
 * - image fetch concurrency bounded by IMAGE_FETCH_CONCURRENCY
 * - single image fetch failure doesn't break the row
 * - large source photos are downscaled before being embedded
 * - end-to-end smoke test produces a valid XLSX buffer
 */

import { randomBytes } from 'node:crypto';

import sharp from 'sharp';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { IMAGE_FETCH_CONCURRENCY } from '../../lib/export/concurrency';
import { readFileBuffer } from '../../storage';
import { buildCollectionLayoutXlsx } from '../collectionLayout.export.xlsx.service';

import type { CollectionLayoutForExport } from '../collectionLayout.export.xlsx.service';
import type { PrismaClient } from '@prisma/client';

vi.mock('../../storage', () => ({
  readFileBuffer: vi.fn(),
}));

const mockPrisma = {
  phase: {
    findMany: vi.fn().mockResolvedValue([]),
  },
} as unknown as PrismaClient;

function makeRow(id: string, pictureKey: string | null) {
  return {
    id,
    collectionLayoutId: 'layout-1',
    groupId: 'group-1',
    order: 0,
    line: 'Line',
    gender: null,
    productCategory: null,
    strategy: null,
    status: null,
    styleStatus: null,
    phaseId: null,
    skuForecast: 10,
    qtyForecast: 100,
    designer: null,
    styleNotes: null,
    materialNotes: null,
    colorNotes: null,
    toolingNotes: null,
    pictureKey,
    createdAt: new Date(),
    updatedAt: new Date(),
    vendor: null,
    quotations: [],
  } as unknown as CollectionLayoutForExport['groups'][number]['rows'][number];
}

function makeLayout(rows: ReturnType<typeof makeRow>[]): CollectionLayoutForExport {
  return {
    id: 'layout-1',
    brandId: 'brand-1',
    seasonId: 'season-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    brand: { name: 'Brand', code: 'BR', logoKey: null },
    season: { name: 'Season', code: 'S1', year: 2026 },
    groups: [
      { id: 'group-1', collectionLayoutId: 'layout-1', name: 'Group 1', order: 0, skuBudget: null, createdAt: new Date(), updatedAt: new Date(), rows } as unknown as CollectionLayoutForExport['groups'][number],
    ],
  } as unknown as CollectionLayoutForExport;
}

describe('buildCollectionLayoutXlsx', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('bounds image fetch concurrency to IMAGE_FETCH_CONCURRENCY', async () => {
    const uniqueKeyCount = IMAGE_FETCH_CONCURRENCY * 3;
    const rows = Array.from({ length: uniqueKeyCount }, (_, i) => makeRow(`row-${i}`, `key-${i}.jpg`));

    let inFlight = 0;
    let peak = 0;
    vi.mocked(readFileBuffer).mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      return null;
    });

    await buildCollectionLayoutXlsx(makeLayout(rows), mockPrisma);

    expect(peak).toBeLessThanOrEqual(IMAGE_FETCH_CONCURRENCY);
    expect(readFileBuffer).toHaveBeenCalledTimes(uniqueKeyCount);
  });

  it('renders a row without a photo when its image fetch fails', async () => {
    vi.mocked(readFileBuffer).mockResolvedValue(null);
    const rows = [makeRow('row-1', 'missing.jpg')];

    const buffer = await buildCollectionLayoutXlsx(makeLayout(rows), mockPrisma);

    expect(buffer.length).toBeGreaterThan(0);
  });

  it('downscales a large source photo before embedding it (OOM regression)', async () => {
    const noise = await sharp(randomBytes(1500 * 1500 * 3), {
      raw: { width: 1500, height: 1500, channels: 3 },
    })
      .jpeg({ quality: 90 })
      .toBuffer();

    vi.mocked(readFileBuffer).mockResolvedValue(noise);
    const rows = [makeRow('row-1', 'huge.jpg')];

    const buffer = await buildCollectionLayoutXlsx(makeLayout(rows), mockPrisma);

    // The full-size source photo must not survive into the output workbook —
    // this is the actual bug: a single large photo embedded at original
    // resolution can exhaust the container's heap on its own.
    expect(buffer.length).toBeLessThan(noise.length);
  });

  it('produces a valid non-empty XLSX buffer (smoke test)', async () => {
    vi.mocked(readFileBuffer).mockResolvedValue(null);
    const rows = [makeRow('row-1', null), makeRow('row-2', 'key.jpg')];

    const buffer = await buildCollectionLayoutXlsx(makeLayout(rows), mockPrisma);

    expect(buffer.length).toBeGreaterThan(0);
    // XLSX is a zip container -> "PK" local file header signature
    expect(buffer.subarray(0, 2).toString('ascii')).toBe('PK');
  });
});
