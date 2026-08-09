'use client';

import type { RouterOutputs } from '@luke/api';

/** Set di parametri pricing come restituito dal router. */
export type PricingParameterSet =
  RouterOutputs['pricing']['parameterSets']['list'][number];

/** Input per computeRowMargin — compatibile con CollectionRow dopo la migrazione quotazioni. */
export interface MarginComputeInput {
  quotations?: Array<{
    pricingParameterSetId?: string | null;
    supplierQuotation?: number | null;
    retailPrice?: number | null;
    sku?: number | null;
  }>;
  qtyForecast: number | null;
}

/** Same green/≥optimal / yellow/≥optimal-3 / red thresholds computeRowMargin uses per row —
 * exported so aggregate views (per-vendor, per-positioning) can classify a plain margin number
 * against a reference optimalMargin without re-deriving the thresholds. */
export function computeMarginStatus(
  marginPct: number,
  optimalMargin: number
): 'green' | 'yellow' | 'red' {
  if (marginPct >= optimalMargin) return 'green';
  if (marginPct >= optimalMargin - 3) return 'yellow';
  return 'red';
}

/** SKU-weighted average of `value` across items that have a positive `sku`; arithmetic mean
 * fallback otherwise. Shared by computeRowMargin (margin) and computeRowRetailPrice (retailPrice)
 * — same weighting rule, only the field being averaged differs. */
function skuWeightedAverage(items: Array<{ value: number; sku: number | null }>): number {
  const withSku = items.filter(i => i.sku !== null && i.sku > 0);
  if (withSku.length > 0) {
    const totalSku = withSku.reduce((s, i) => s + i.sku!, 0);
    return withSku.reduce((s, i) => s + i.value * i.sku!, 0) / totalSku;
  }
  return items.reduce((s, i) => s + i.value, 0) / items.length;
}

const DEFAULT_OPTIMAL_MARGIN = 52;

/** The parameter set used as the margin-target reference for aggregate (non-row) views — the
 * season's default variant, falling back to the first one, falling back to a generic default
 * when no parameter sets exist yet. */
export function getReferenceOptimalMargin(parameterSets: PricingParameterSet[]): number {
  return (parameterSets.find(p => p.isDefault) ?? parameterSets[0])?.optimalMargin ?? DEFAULT_OPTIMAL_MARGIN;
}

/** SKU-weighted average margin if any quotation has sku set; otherwise arithmetic average. */
export function computeRowMargin(
  row: MarginComputeInput,
  parameterSets: PricingParameterSet[]
): { margin: number; isAboveTarget: boolean; marginStatus: 'green' | 'yellow' | 'red' } | null {
  const computed: Array<{ value: number; sku: number | null }> = [];
  let refOptimalMargin = DEFAULT_OPTIMAL_MARGIN;

  for (const q of row.quotations ?? []) {
    if (!q?.pricingParameterSetId || !q?.supplierQuotation || !q?.retailPrice) continue;
    if (q.supplierQuotation <= 0 || q.retailPrice <= 0) continue;
    const ps = parameterSets.find(p => p.id === q.pricingParameterSetId);
    if (!ps) continue;

    const qc = q.supplierQuotation * (ps.qualityControlPercent / 100);
    const withQC = q.supplierQuotation + qc + ps.tools;
    const withTransport = withQC + ps.transportInsuranceCost;
    const withDuty = withTransport * (1 + ps.duty / 100);
    const landed = withDuty / ps.exchangeRate + ps.italyAccessoryCosts;
    const wholesale = q.retailPrice / ps.retailMultiplier;
    computed.push({ value: (wholesale - landed) / wholesale, sku: q.sku ?? null });
    refOptimalMargin = ps.optimalMargin;
  }

  if (computed.length === 0) return null;

  const avg = skuWeightedAverage(computed);
  const marginStatus = computeMarginStatus(avg * 100, refOptimalMargin);

  return {
    margin: Math.round(avg * 10000) / 10000,
    isAboveTarget: marginStatus === 'green',
    marginStatus,
  };
}

/**
 * Quantity-weighted average margin across multiple collection rows.
 * Returns null when no row has computable margin data.
 */
export function computeWeightedMargin(
  rows: MarginComputeInput[],
  parameterSets: PricingParameterSet[]
): number | null {
  let totalQty = 0;
  let weightedSum = 0;
  for (const row of rows) {
    const m = computeRowMargin(row, parameterSets);
    if (!m) continue;
    weightedSum += m.margin * (row.qtyForecast ?? 0);
    totalQty += row.qtyForecast ?? 0;
  }
  return totalQty > 0 ? Math.round((weightedSum / totalQty) * 10000) / 10000 : null;
}

/** Classe Tailwind testo per stato margine — stesso mapping usato in CollectionGroupSection. */
export const MARGIN_STATUS_TEXT_CLASS: Record<'green' | 'yellow' | 'red', string> = {
  green: 'text-green-700 dark:text-green-400',
  yellow: 'text-amber-600 dark:text-amber-400',
  red: 'text-destructive',
};

/** Colore per fill dei grafici (recharts) — stessi hue di MARGIN_STATUS_TEXT_CLASS via CSS var. */
export const MARGIN_STATUS_CHART_COLOR: Record<'green' | 'yellow' | 'red', string> = {
  green: 'hsl(var(--status-good))',
  yellow: 'hsl(var(--status-warning))',
  red: 'hsl(var(--destructive))',
};

export const MARGIN_STATUS_LABEL: Record<'green' | 'yellow' | 'red', string> = {
  green: 'In target',
  yellow: 'Vicino al target',
  red: 'Sotto target',
};

/** Input per computeRowRetailPrice — sottoinsieme di MarginComputeInput['quotations']. */
export interface RetailPriceComputeInput {
  quotations?: Array<{
    pricingParameterSetId?: string | null;
    retailPrice?: number | null;
    sku?: number | null;
  }>;
}

/**
 * SKU-weighted average retail price across a row's quotations (arithmetic mean fallback,
 * same weighting as computeRowMargin — kept consistent for comparability between the two).
 * `currency` is the sellingCurrency of the contributing parameter set(s); 'MISTO' if a row's
 * quotations span more than one sellingCurrency (rare, but sellingCurrency is per-parameter-set).
 * Returns null when the row has no quotation with a valid retailPrice.
 */
export function computeRowRetailPrice(
  row: RetailPriceComputeInput,
  parameterSets: PricingParameterSet[]
): { retailPrice: number; currency: string } | null {
  const computed: Array<{ value: number; sku: number | null; currency: string }> = [];

  for (const q of row.quotations ?? []) {
    if (!q?.pricingParameterSetId || !q?.retailPrice || q.retailPrice <= 0) continue;
    const ps = parameterSets.find(p => p.id === q.pricingParameterSetId);
    if (!ps) continue;
    computed.push({ value: q.retailPrice, sku: q.sku ?? null, currency: ps.sellingCurrency });
  }

  if (computed.length === 0) return null;

  const avg = skuWeightedAverage(computed);
  const currencies = new Set(computed.map(m => m.currency));
  const currency = currencies.size === 1 ? computed[0].currency : 'MISTO';

  return { retailPrice: Math.round(avg * 100) / 100, currency };
}

/** Minimal vendor shape needed for display — matches the `{id, name, nickname}` select used by
 * collectionLayout.get across the app. */
export interface VendorLike {
  id: string;
  name: string;
  nickname?: string | null;
}

/** Display name for a vendor — nickname takes precedence over the official name. `fallback` is
 * returned as-is (string or null) when there's no vendor, so callers can pick what an absent
 * vendor should read as (`'—'`, `'Senza fornitore'`, `null` for search/filter matching, ...). */
export function resolveVendorName<F extends string | null>(
  vendor: VendorLike | null | undefined,
  fallback: F
): string | F {
  return vendor ? (vendor.nickname ?? vendor.name) : fallback;
}

const NO_VENDOR_KEY = '__none__';

/** Groups rows by vendor (id, or a shared sentinel key for rows with no vendor), resolving the
 * display name once per group. Callers derive their own per-group sums from `.rows`. */
export function groupRowsByVendor<T extends { vendor?: VendorLike | null }>(
  rows: T[],
  noVendorLabel = 'Senza fornitore'
): Array<{ key: string; name: string; rows: T[] }> {
  const map = new Map<string, { key: string; name: string; rows: T[] }>();
  for (const row of rows) {
    const key = row.vendor?.id ?? NO_VENDOR_KEY;
    const existing = map.get(key);
    if (existing) {
      existing.rows.push(row);
    } else {
      map.set(key, { key, name: resolveVendorName(row.vendor, noVendorLabel), rows: [row] });
    }
  }
  return Array.from(map.values());
}

/** Shared sentinel for "no pricePositioning assigned" — used by both the retail-price
 * distribution chart and the positioning×margin crosstab so the two stay in sync. */
export const UNASSIGNED_POSITIONING_KEY = '__unassigned_positioning__';
