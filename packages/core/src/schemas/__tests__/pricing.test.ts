/**
 * The retail multiplier is accepted to the cent — including cents binary floats cannot hold exactly
 * (0.07, 4.35), which a naive `value * 100` integer check would refuse.
 */
import { describe, expect, it } from 'vitest';

import { PricingCalculateInputSchema, PricingParameterSetInputSchema } from '../pricing.js';

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

describe('PricingCalculateInputSchema — each mode requires its own prices', () => {
  const IDS = {
    parameterSetId: '3f1c2a4e-9b7d-4c1e-8a2b-1234567890ab',
    brandId: '4f1c2a4e-9b7d-4c1e-8a2b-1234567890ab',
    seasonId: '5f1c2a4e-9b7d-4c1e-8a2b-1234567890ab',
  };
  const failingPaths = (input: object) =>
    (PricingCalculateInputSchema.safeParse({ ...IDS, ...input }).error?.issues ?? []).map(issue =>
      issue.path.join('.')
    );

  it.each([
    [{ mode: 'forward', retailPrice: 129.9 }, ['purchasePrice']],
    [{ mode: 'inverse', purchasePrice: 50 }, ['retailPrice']],
    [{ mode: 'margin', purchasePrice: 50 }, ['retailPrice']],
    [{ mode: 'margin' }, ['purchasePrice', 'retailPrice']],
  ])('%o fails on %o', (input, paths) => {
    expect(failingPaths(input)).toEqual(paths);
  });

  it('names the missing price in Italian, as the refine it replaces did', () => {
    const issue = PricingCalculateInputSchema.safeParse({ ...IDS, mode: 'inverse' }).error?.issues[0];
    expect(issue?.message).toBe('Inserisci il prezzo retail');
  });

  it.each([
    { mode: 'forward', purchasePrice: 50 },
    { mode: 'inverse', retailPrice: 129.9 },
    { mode: 'margin', purchasePrice: 50, retailPrice: 129.9 },
  ])('%o passes', input => {
    expect(failingPaths(input)).toEqual([]);
  });
});
