import { expect, test } from 'vitest';

import { classifyMargin, formatMarginPct } from '@luke/core';

import { computeRowMargin, computeWeightedMargin } from '../pricingCalc';

import type { PricingParameterSet } from '../pricingCalc';

/**
 * A margin just below target must read 52.0 and be yellow in every view (#79). The row and
 * weighted averages rounded to four decimals before the aggregate views classified them, which
 * turned it green.
 */

const SET: PricingParameterSet = {
  id: '00000000-0000-4000-8000-000000000001',
  brandId: '00000000-0000-4000-8000-000000000002',
  seasonId: '00000000-0000-4000-8000-000000000003',
  name: 'Standard',
  countryCode: 'CN',
  purchaseCurrency: 'USD',
  sellingCurrency: 'EUR',
  qualityControlPercent: 2,
  transportInsuranceCost: 3,
  duty: 8,
  exchangeRate: 1.08,
  italyAccessoryCosts: 2,
  tools: 1,
  retailMultiplier: 2.6,
  optimalMargin: 52,
  isDefault: true,
  orderIndex: 0,
  createdAt: '2026-10-17T00:00:00.000Z',
  updatedAt: '2026-10-17T00:00:00.000Z',
};

// Purchase 48.4 at retail 299.9 leaves 51.998 %: the calculator's inverse answer for that retail.
const ROW = {
  quotations: [{ pricingParameterSetId: SET.id, supplierQuotation: 48.4, retailPrice: 299.9, sku: null }],
  qtyForecast: 10,
};

test('a row just below target is yellow and reads 52.0, alone and averaged', () => {
  const row = computeRowMargin(ROW, [SET]);
  const weighted = computeWeightedMargin([ROW, ROW], [SET]);

  expect(row?.marginStatus).toBe('yellow');
  expect(weighted).not.toBeNull();
  expect(classifyMargin((weighted ?? 0) * 100, SET.optimalMargin)).toBe('yellow');
  expect(formatMarginPct(row?.margin ?? 0)).toBe('52.0%');
  expect(formatMarginPct(weighted ?? 0)).toBe('52.0%');
});
