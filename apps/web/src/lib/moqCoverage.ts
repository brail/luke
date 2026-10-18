/**
 * Cluster MOQ coverage, read by Control's `Criticità cluster` tab: it groups the complete rows of a
 * collection layout by gender × category × price positioning × strategy and compares the pairs the
 * cluster forecasts (A) with the pairs its vendors' colour minimums require (B).
 *
 * Named "MOQ coverage" in code, never "criticality": in the collection layout that word already
 * means phase-deadline criticality (`CriticalityBadge`).
 */

/** The row fields the computation reads, a structural subset of a `collectionLayout.get` row. */
export interface MoqCoverageRow {
  gender: string;
  productCategory: string;
  pricePositioning: string | null;
  strategy: string | null;
  qtyForecast: number | null;
  skuForecast: number | null;
  vendor: { moqPerColor: number | null } | null;
}

export interface MoqCluster {
  key: string;
  gender: string;
  /** The first spelling met, trimmed: rows are grouped ignoring case and surrounding spaces. */
  category: string;
  pricePositioning: string;
  strategy: string;
  /** The complete rows in the cluster. */
  rowCount: number;
  /** Σ skuForecast: how crowded the cluster is. */
  sku: number;
  /** A: Σ qtyForecast, in pairs. */
  forecastPairs: number;
  /** B: Σ (vendor moqPerColor × skuForecast), row by row, in pairs. */
  minimumPairs: number;
  /** A / B, or `null` when B is 0, which only rows saved before the schema bounds can produce. */
  ratio: number | null;
  /** A / B < `MOQ_COVERAGE_THRESHOLD`. */
  belowMoq: boolean;
}

/** The threshold in tenths, so the comparison stays in integers and 0.70 is never below it. */
const THRESHOLD_TENTHS = 7;
export const MOQ_COVERAGE_THRESHOLD = THRESHOLD_TENTHS / 10;

/**
 * Builds the clusters from the complete rows: those with a strategy, a price positioning, both
 * forecasts and a vendor whose colour minimum is set. Other rows are left out entirely; the
 * `Qualità Dato` card counts them. Sorted by A / B ascending, so the clusters below the threshold
 * come first, clusters without a ratio last, ties by key.
 */
export function buildMoqClusters(rows: readonly MoqCoverageRow[]): MoqCluster[] {
  const clusters = new Map<string, Omit<MoqCluster, 'ratio' | 'belowMoq'>>();

  for (const row of rows) {
    const moq = row.vendor?.moqPerColor;
    const { gender, pricePositioning, strategy, qtyForecast, skuForecast } = row;
    if (moq == null || !pricePositioning || !strategy || qtyForecast == null || skuForecast == null) continue;

    const category = row.productCategory.trim();
    // A tuple, not a joined string: category is free text and could contain any separator.
    const key = JSON.stringify([gender, category.toLowerCase(), pricePositioning, strategy]);
    let cluster = clusters.get(key);
    if (!cluster) {
      cluster = { key, gender, category, pricePositioning, strategy, rowCount: 0, sku: 0, forecastPairs: 0, minimumPairs: 0 };
      clusters.set(key, cluster);
    }
    cluster.rowCount++;
    cluster.sku += skuForecast;
    cluster.forecastPairs += qtyForecast;
    cluster.minimumPairs += moq * skuForecast;
  }

  return Array.from(clusters.values(), c => ({
    ...c,
    ratio: c.minimumPairs > 0 ? c.forecastPairs / c.minimumPairs : null,
    belowMoq: c.forecastPairs * 10 < c.minimumPairs * THRESHOLD_TENTHS,
  })).sort((a, b) => (a.ratio ?? Infinity) - (b.ratio ?? Infinity) || a.key.localeCompare(b.key));
}

/**
 * A / B with two decimals, truncated rather than rounded so a cluster below the threshold never
 * reads 0,70. Computed from the integers, which keeps the truncation exact.
 */
export function formatMoqCoverageRatio({ forecastPairs, minimumPairs }: MoqCluster): string {
  if (minimumPairs === 0) return '—';
  return (Math.floor((forecastPairs * 100) / minimumPairs) / 100)
    .toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
