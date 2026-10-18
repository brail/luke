/**
 * Contract of the cluster MOQ coverage (#125): B is summed row by row, 0.70 is the first value that
 * is not below the threshold, incomplete rows change no cluster, and category is grouped ignoring
 * case and surrounding spaces.
 */

import { describe, it, expect } from 'vitest';

import { buildMoqClusters, formatMoqCoverageRatio, type MoqCoverageRow } from '../moqCoverage';

const row = (overrides: Partial<MoqCoverageRow> = {}): MoqCoverageRow => ({
  gender: 'WOMAN',
  productCategory: 'Sneaker',
  pricePositioning: 'PREMIUM',
  strategy: 'CORE',
  qtyForecast: 100,
  skuForecast: 1,
  vendor: { moqPerColor: 100 },
  ...overrides,
});

describe('buildMoqClusters', () => {
  it('computes B row by row, not as the sum of minimums times the sum of SKUs', () => {
    const [cluster] = buildMoqClusters([
      row({ skuForecast: 1, vendor: { moqPerColor: 100 }, qtyForecast: 50 }),
      row({ skuForecast: 3, vendor: { moqPerColor: 300 }, qtyForecast: 70 }),
    ]);
    // 100 × 1 + 300 × 3 = 1000; (100 + 300) × (1 + 3) would give 1600.
    expect(cluster).toMatchObject({ rowCount: 2, sku: 4, forecastPairs: 120, minimumPairs: 1000 });
  });

  it('is below the threshold at 0.69 and not at 0.70', () => {
    const [below] = buildMoqClusters([row({ qtyForecast: 69 })]);
    const [at] = buildMoqClusters([row({ qtyForecast: 70 })]);
    expect(below).toMatchObject({ ratio: 0.69, belowMoq: true });
    expect(at).toMatchObject({ ratio: 0.7, belowMoq: false });
  });

  it('leaves out a row missing any required field', () => {
    const complete = row({ qtyForecast: 50 });
    const expected = buildMoqClusters([complete]);
    const incomplete: Partial<MoqCoverageRow>[] = [
      { strategy: null },
      { pricePositioning: null },
      { qtyForecast: null },
      { skuForecast: null },
      { vendor: null },
      { vendor: { moqPerColor: null } },
    ];
    for (const overrides of incomplete) {
      expect(buildMoqClusters([complete, row({ qtyForecast: 999, ...overrides })]), JSON.stringify(overrides))
        .toEqual(expected);
    }
  });

  it('groups category ignoring case and surrounding spaces, keeping the first spelling', () => {
    const clusters = buildMoqClusters([
      row({ productCategory: ' Sneaker ' }),
      row({ productCategory: 'sneaker' }),
      row({ productCategory: 'Boot' }),
    ]);
    expect(clusters.map(c => [c.category, c.sku])).toEqual([['Boot', 1], ['Sneaker', 2]]);
  });

  it('sorts by ratio ascending, clusters without a ratio last', () => {
    const clusters = buildMoqClusters([
      row({ productCategory: 'High', qtyForecast: 200 }),
      row({ productCategory: 'Legacy', skuForecast: 0 }),
      row({ productCategory: 'Low', qtyForecast: 30 }),
    ]);
    expect(clusters.map(c => [c.category, c.ratio, c.belowMoq])).toEqual([
      ['Low', 0.3, true],
      ['High', 2, false],
      ['Legacy', null, false],
    ]);
  });
});

describe('formatMoqCoverageRatio', () => {
  it('truncates, so a ratio just below the threshold never reads 0,70', () => {
    const [cluster] = buildMoqClusters([row({ qtyForecast: 6999, vendor: { moqPerColor: 10_000 } })]);
    expect(cluster.belowMoq).toBe(true);
    expect(formatMoqCoverageRatio(cluster)).toBe('0,69');
  });

  it('shows a dash without a ratio', () => {
    const [cluster] = buildMoqClusters([row({ skuForecast: 0 })]);
    expect(formatMoqCoverageRatio(cluster)).toBe('—');
  });
});
