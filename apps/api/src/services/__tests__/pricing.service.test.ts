/**
 * Invariants of the price calculation engine.
 *
 * The three functions are pure and don't touch the database: they belong in the unit tier.
 * Careful though — **these assertions don't move the procedure coverage
 * gate**, which measures invocations on `appRouter`. Coverage of the `pricing`
 * router lives in `test/pricing.integration.spec.ts`.
 *
 * None of these assertions is derived by reading the implementation: they are
 * relationships that must hold *whatever* the formula is, which is why they
 * survive a refactor of the calculation. A test that manually recomputes the same
 * chain of multiplications would say nothing: it would only fail if someone
 * changes the formula, which is exactly when it's legitimate to do so.
 */

import { describe, it, expect } from 'vitest';

import {
  calculateForward,
  calculateInverse,
  calculateMarginOnly,
  type CalcParams,
} from '../pricing.service';

/** Realistic parameters: the same orders of magnitude as the seed. */
const PARAMS: CalcParams = {
  qualityControlPercent: 2,
  transportInsuranceCost: 3,
  duty: 8,
  exchangeRate: 1.08,
  italyAccessoryCosts: 2,
  tools: 1,
  retailMultiplier: 2.6,
  optimalMargin: 62,
  purchaseCurrency: 'CNY',
  sellingCurrency: 'EUR',
};

describe('calculateForward', () => {
  it('hits the company margin declared in the parameters', () => {
    const result = calculateForward(100, PARAMS);

    // This is the parameter set's promise: `optimalMargin` isn't an aspiration,
    // it's what the company multiplier must produce. If one day they
    // diverge, the retail price no longer holds up the promised margin.
    expect(result.companyMargin * 100).toBeCloseTo(PARAMS.optimalMargin, 1);
  });

  it('the margin depends only on optimalMargin, not on the purchase price', () => {
    const cheap = calculateForward(10, PARAMS);
    const expensive = calculateForward(1000, PARAMS);

    // The margin is a property of the parameter set. If it scales with the price,
    // someone has moved a fixed cost into the multiplicative part.
    expect(cheap.companyMargin).toBeCloseTo(expensive.companyMargin, 4);
  });

  it('the cost chain is monotonic: no step lowers the price', () => {
    const r = calculateForward(100, PARAMS);

    // With positive costs and percentages, no step can lower the value.
    // Catches an inverted sign at any point in the chain.
    expect(r.priceWithQC).toBeGreaterThanOrEqual(r.purchasePrice);
    expect(r.priceWithTransport).toBeGreaterThanOrEqual(r.priceWithQC);
    expect(r.priceWithDuty).toBeGreaterThanOrEqual(r.priceWithTransport);
    expect(r.wholesalePrice).toBeGreaterThan(r.landedCost);
    expect(r.retailPrice).toBeGreaterThan(r.wholesalePrice);
  });

  it('a higher purchase price produces a higher retail price', () => {
    // Monotonicity with respect to the input: trivial to verify, and the one thing
    // that distinguishes a pricing engine from a number generator.
    expect(calculateForward(200, PARAMS).retailPriceRaw).toBeGreaterThan(
      calculateForward(100, PARAMS).retailPriceRaw
    );
  });
});

describe('calculateInverse', () => {
  it('is the inverse of calculateForward', () => {
    const purchasePrice = 137.5;
    const forward = calculateForward(purchasePrice, PARAMS);

    // Starting from `retailPriceRaw` and not `retailPrice`: the latter is
    // rounded to a psychological price, so the round trip couldn't close
    // exactly. The invariant concerns the calculation chain, not the
    // commercial rounding.
    const back = calculateInverse(forward.retailPriceRaw, PARAMS);

    // To within what `retailPriceRaw`'s own 2-decimal rounding leaves (≈ 0.001 here). One
    // decimal hid a real gap: the inverse undid QC before tools, as if QC were charged on
    // tools too, and came back short by tools × qc / (1 + qc) ≈ 0.02.
    expect(back.purchasePriceRaw).toBeCloseTo(purchasePrice, 2);
  });

  it('rebuilds the same intermediate values as forward', () => {
    const forward = calculateForward(137.5, PARAMS);
    const back = calculateInverse(forward.retailPriceRaw, PARAMS);

    expect(back.wholesalePrice).toBeCloseTo(forward.wholesalePrice, 1);
    expect(back.landedCost).toBeCloseTo(forward.landedCost, 1);
    expect(back.companyMargin).toBeCloseTo(forward.companyMargin, 3);
    // QC is charged on the purchase price alone, tools excluded.
    expect(back.qualityControlCost).toBeCloseTo(forward.qualityControlCost, 2);
  });

  it('rounds the purchase price down', () => {
    const back = calculateInverse(1000, PARAMS);

    // Rounding the maximum payable price up would erode the margin:
    // the rounding direction is a commercial choice, not a
    // numerical detail.
    expect(back.purchasePrice).toBeLessThanOrEqual(back.purchasePriceRaw);
  });
});

describe('calculateMarginOnly', () => {
  it('confirms the declared margin when the prices come from forward', () => {
    const forward = calculateForward(100, PARAMS);
    const margin = calculateMarginOnly(100, forward.retailPriceRaw, PARAMS);

    // The three modes must tell the same story on the same numbers.
    expect(margin.companyMargin).toBeCloseTo(forward.companyMargin, 3);
    expect(margin.landedCost).toBeCloseTo(forward.landedCost, 1);
  });

  it('a lower retail price at equal cost squeezes the margin', () => {
    const full = calculateMarginOnly(100, 800, PARAMS);
    const discounted = calculateMarginOnly(100, 600, PARAMS);

    expect(discounted.companyMargin).toBeLessThan(full.companyMargin);
  });

  it('flags a negative margin when retail does not cover the cost', () => {
    // Edge case that really matters: selling below cost must produce a
    // negative number, not an error or a silent zero.
    const result = calculateMarginOnly(100, 150, PARAMS);

    expect(result.companyMargin).toBeLessThan(0);
  });
});

/**
 * Every field of the three modes, pinned at two margins whose company multipliers round in opposite
 * directions (52 %: 2.0833 → 2.08; 65 %: 2.857 → 2.86). Captured before the engine moved to core:
 * a refactor of the chain must leave every one of them where it is.
 */
describe('pricing modes, field by field', () => {
  const GOLDEN = [
    {
      optimalMargin: 52,
      forward: {
        mode: 'forward',
        purchasePrice: 137.5,
        qualityControlCost: 2.75,
        priceWithQC: 141.25,
        transportInsuranceCost: 3,
        priceWithTransport: 144.25,
        dutyCost: 11.54,
        priceWithDuty: 155.79,
        italyAccessoryCosts: 2,
        landedCost: 146.25,
        companyMultiplier: 2.08,
        wholesalePrice: 304.2,
        retailPriceRaw: 790.92,
        retailPrice: 789.9,
        companyMargin: 0.5192,
        purchaseCurrency: 'CNY',
        sellingCurrency: 'EUR',
      },
      inverse: {
        mode: 'inverse',
        retailPrice: 299.9,
        wholesalePrice: 115.35,
        landedCost: 55.45,
        priceWithoutAccessories: 53.45,
        dutyCost: 3.96,
        priceWithoutDuty: 49.5,
        priceWithoutTransport: 50.45,
        qualityControlCost: 0.97,
        purchasePriceRaw: 48.49,
        purchasePrice: 48.4,
        companyMargin: 0.5192,
        purchaseCurrency: 'CNY',
        sellingCurrency: 'EUR',
      },
      margin: {
        mode: 'margin',
        purchasePrice: 137.5,
        retailPrice: 299.9,
        landedCost: 146.25,
        wholesalePrice: 115.35,
        companyMargin: -0.2679,
        companyMultiplier: 2.08,
        purchaseCurrency: 'CNY',
        sellingCurrency: 'EUR',
      },
    },
    {
      optimalMargin: 65,
      forward: {
        mode: 'forward',
        purchasePrice: 137.5,
        qualityControlCost: 2.75,
        priceWithQC: 141.25,
        transportInsuranceCost: 3,
        priceWithTransport: 144.25,
        dutyCost: 11.54,
        priceWithDuty: 155.79,
        italyAccessoryCosts: 2,
        landedCost: 146.25,
        companyMultiplier: 2.86,
        wholesalePrice: 418.27,
        retailPriceRaw: 1087.51,
        retailPrice: 1089.9,
        companyMargin: 0.6503,
        purchaseCurrency: 'CNY',
        sellingCurrency: 'EUR',
      },
      inverse: {
        mode: 'inverse',
        retailPrice: 299.9,
        wholesalePrice: 115.35,
        landedCost: 40.33,
        priceWithoutAccessories: 38.33,
        dutyCost: 2.84,
        priceWithoutDuty: 35.49,
        priceWithoutTransport: 35.33,
        qualityControlCost: 0.67,
        purchasePriceRaw: 33.66,
        purchasePrice: 33.6,
        companyMargin: 0.6503,
        purchaseCurrency: 'CNY',
        sellingCurrency: 'EUR',
      },
      margin: {
        mode: 'margin',
        purchasePrice: 137.5,
        retailPrice: 299.9,
        landedCost: 146.25,
        wholesalePrice: 115.35,
        companyMargin: -0.2679,
        companyMultiplier: 2.86,
        purchaseCurrency: 'CNY',
        sellingCurrency: 'EUR',
      },
    },
  ] as const;

  it.each(GOLDEN)('at $optimalMargin % they stay where they were', ({ optimalMargin, forward, inverse, margin }) => {
    const params = { ...PARAMS, optimalMargin };
    expect(calculateForward(137.5, params)).toEqual(forward);
    expect(calculateInverse(299.9, params)).toEqual(inverse);
    expect(calculateMarginOnly(137.5, 299.9, params)).toEqual(margin);
  });
});
