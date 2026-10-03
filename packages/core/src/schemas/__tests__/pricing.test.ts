/**
 * The retail multiplier is accepted to the cent, like the company multiplier the pricing engine
 * derives from the margin — including cents binary floats cannot hold exactly (0.07, 4.35), which a
 * naive `value * 100` integer check would refuse.
 */
import { describe, expect, it } from 'vitest';

import { PricingParameterSetInputSchema } from '../pricing.js';

const VALID = {
  name: 'Pelle',
  countryCode: 'CN',
  purchaseCurrency: 'CNY',
  sellingCurrency: 'EUR',
  qualityControlPercent: 2,
  transportInsuranceCost: 3,
  duty: 8,
  exchangeRate: 1.08,
  italyAccessoryCosts: 2,
  tools: 1,
  retailMultiplier: 2.6,
  optimalMargin: 52,
} as const;

const retailMultiplierIssues = (retailMultiplier: number) =>
  (PricingParameterSetInputSchema.safeParse({ ...VALID, retailMultiplier }).error?.issues ?? []).filter(
    issue => issue.path[0] === 'retailMultiplier'
  );

describe('PricingParameterSetInputSchema — retailMultiplier', () => {
  it.each([2.6, 2.65, 0.07, 4.35, 3])('accepts %s', value => {
    expect(retailMultiplierIssues(value)).toEqual([]);
  });

  it.each([2.655, 2.625, 2.001])('refuses %s, which has more than two decimals', value => {
    expect(retailMultiplierIssues(value).map(issue => issue.message)).toEqual([
      'Il moltiplicatore retail ammette al massimo due decimali',
    ]);
  });
});
