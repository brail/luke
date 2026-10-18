/**
 * The collection-layout xlsx classified a quotation's margin after rounding it to two decimals,
 * while the screen and the PDF classify it before: 51.996 % read green in the workbook and yellow
 * everywhere else. It now classifies the unrounded value and rounds only what it shows.
 */

import { describe, it, expect } from 'vitest';

import { computeQuotationMargin } from '../src/services/collectionLayout.export.xlsx.service';

import type { QuotationWithParamSet } from '../src/services/collectionLayout.service';

// A neutral parameter set: landed cost = quotation, wholesale = retail.
const params = {
  qualityControlPercent: 0,
  tools: 0,
  transportInsuranceCost: 0,
  duty: 0,
  exchangeRate: 1,
  italyAccessoryCosts: 0,
  retailMultiplier: 1,
  optimalMargin: 52,
};

function quotation(supplierQuotation: number, retailPrice: number): QuotationWithParamSet {
  // Only the fields the margin reads; the rest of the Prisma row is irrelevant here.
  return {
    supplierQuotation,
    retailPrice,
    sku: null,
    pricingParameterSet: params,
  } as unknown as QuotationWithParamSet;
}

describe('computeQuotationMargin', () => {
  it('classifies the unrounded margin and rounds only what it shows', () => {
    // (100000 − 48004) / 100000 = 51.996 %: shown as 52, yellow against a 52 % target.
    expect(computeQuotationMargin(quotation(48004, 100000))).toEqual({
      pct: 52,
      status: 'yellow',
      fillColor: 'FFF9C4',
    });
  });

  it('is green at the target and red more than three points below it', () => {
    expect(computeQuotationMargin(quotation(48000, 100000))?.status).toBe('green');
    expect(computeQuotationMargin(quotation(51001, 100000))?.status).toBe('red');
  });

  it('has nothing to show without both prices', () => {
    expect(computeQuotationMargin(quotation(0, 100000))).toBeNull();
    expect(computeQuotationMargin(quotation(48000, 0))).toBeNull();
  });
});
