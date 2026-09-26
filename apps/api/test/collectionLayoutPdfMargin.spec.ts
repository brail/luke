/**
 * The collection-layout PDF averages a row's quotation margins the way the web's
 * `computeRowMargin` does (`apps/web/src/app/(app)/product/_shared/pricingCalc.ts`): weighted by
 * SKU when any quotation has SKU > 0, an arithmetic mean otherwise. The PDF used the plain mean,
 * so a row could show one margin and status on screen and another in the export.
 */

import { describe, it, expect } from 'vitest';

import { computeMarginResult } from '../src/services/collectionLayout.export.pdf.service';

import type { QuotationWithParamSet } from '../src/services/collectionLayout.service';

// A neutral parameter set: no costs on top of the quotation, exchange rate 1, wholesale = retail / 2.
const params = {
  qualityControlPercent: 0,
  tools: 0,
  transportInsuranceCost: 0,
  duty: 0,
  exchangeRate: 1,
  italyAccessoryCosts: 0,
  retailMultiplier: 2,
  optimalMargin: 52,
};

function quotation(supplierQuotation: number, sku: number | null): QuotationWithParamSet {
  // Only the fields the margin reads; the rest of the Prisma row is irrelevant here.
  return {
    supplierQuotation,
    retailPrice: 100,
    sku,
    pricingParameterSet: params,
  } as unknown as QuotationWithParamSet;
}

// Wholesale 50: a quotation of 10 gives an 80% margin, one of 40 gives 20%.
describe('computeMarginResult', () => {
  it('weights the margins by SKU when any quotation has SKU', () => {
    // (80 × 1 + 20 × 3) / 4 = 35: red. The plain mean, 50, would have been yellow.
    expect(computeMarginResult([quotation(10, 1), quotation(40, 3)])).toEqual({
      pct: 35,
      isAboveTarget: false,
      isWarning: false,
    });
  });

  it('ignores quotations without SKU once another one has it', () => {
    expect(computeMarginResult([quotation(10, 0), quotation(40, 3)])?.pct).toBe(20);
    expect(computeMarginResult([quotation(10, null), quotation(40, 3)])?.pct).toBe(20);
  });

  it('falls back to the arithmetic mean when no quotation has SKU', () => {
    expect(computeMarginResult([quotation(10, null), quotation(40, 0)])).toEqual({
      pct: 50,
      isAboveTarget: false,
      isWarning: true,
    });
  });
});
