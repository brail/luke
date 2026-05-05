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
  }>;
  qtyForecast: number;
}

function computeMarginStatus(
  marginPct: number,
  optimalMargin: number
): 'green' | 'yellow' | 'red' {
  if (marginPct >= optimalMargin) return 'green';
  if (marginPct >= optimalMargin - 3) return 'yellow';
  return 'red';
}

/** Compute arithmetic average margin across all computable quotations of a row. */
export function computeRowMargin(
  row: MarginComputeInput,
  parameterSets: PricingParameterSet[]
): { margin: number; isAboveTarget: boolean; marginStatus: 'green' | 'yellow' | 'red' } | null {
  const margins: number[] = [];
  let refOptimalMargin = 52;

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
    margins.push((wholesale - landed) / wholesale);
    refOptimalMargin = ps.optimalMargin;
  }

  if (margins.length === 0) return null;
  const avg = margins.reduce((sum, m) => sum + m, 0) / margins.length;
  const marginStatus = computeMarginStatus(avg * 100, refOptimalMargin);

  return {
    margin: Math.round(avg * 10000) / 10000,
    isAboveTarget: marginStatus === 'green',
    marginStatus,
  };
}

/** Compute qty-weighted average margin across rows using first quotation per row. */
export function computeWeightedMargin(
  rows: MarginComputeInput[],
  parameterSets: PricingParameterSet[]
): number | null {
  let totalQty = 0;
  let weightedSum = 0;
  for (const row of rows) {
    const m = computeRowMargin(row, parameterSets);
    if (!m) continue;
    weightedSum += m.margin * row.qtyForecast;
    totalQty += row.qtyForecast;
  }
  return totalQty > 0 ? Math.round((weightedSum / totalQty) * 10000) / 10000 : null;
}
