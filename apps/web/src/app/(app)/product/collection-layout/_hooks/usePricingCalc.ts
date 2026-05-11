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

/** SKU-weighted average margin if any quotation has sku set; otherwise arithmetic average. */
export function computeRowMargin(
  row: MarginComputeInput,
  parameterSets: PricingParameterSet[]
): { margin: number; isAboveTarget: boolean; marginStatus: 'green' | 'yellow' | 'red' } | null {
  const computed: Array<{ margin: number; sku: number | null }> = [];
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
    computed.push({ margin: (wholesale - landed) / wholesale, sku: q.sku ?? null });
    refOptimalMargin = ps.optimalMargin;
  }

  if (computed.length === 0) return null;

  const withSku = computed.filter(m => m.sku !== null && m.sku > 0);
  let avg: number;
  if (withSku.length > 0) {
    const totalSku = withSku.reduce((s, m) => s + m.sku!, 0);
    avg = withSku.reduce((s, m) => s + m.margin * m.sku!, 0) / totalSku;
  } else {
    avg = computed.reduce((s, m) => s + m.margin, 0) / computed.length;
  }

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
