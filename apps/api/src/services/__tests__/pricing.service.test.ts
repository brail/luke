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

import { classifyMargin, formatMarginPct, retailMargin } from '@luke/core';

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
  it('builds the wholesale price at the margin declared in the parameters', () => {
    const r = calculateForward(100, PARAMS);

    // This is the parameter set's promise: `optimalMargin` isn't an aspiration,
    // it's what the company multiplier must produce. If one day they
    // diverge, the retail price no longer holds up the promised margin.
    // To within the 2-decimal rounding of the amounts: the multiplier itself is exact (#132).
    // The reported margin is another number: the suggested retail price's.
    expect(((r.wholesalePrice - r.landedCost) / r.wholesalePrice) * 100).toBeCloseTo(
      PARAMS.optimalMargin,
      1
    );
  });

  it('the wholesale margin depends only on optimalMargin, not on the purchase price', () => {
    const wholesaleMargin = (p: number) => {
      const r = calculateForward(p, PARAMS);
      return (r.wholesalePrice - r.landedCost) / r.wholesalePrice;
    };

    // A property of the parameter set. If it scales with the price, someone has moved a fixed
    // cost into the multiplicative part. To within the 2-decimal rounding of the amounts.
    expect(wholesaleMargin(10)).toBeCloseTo(wholesaleMargin(1000), 3);
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

  it.each([10, 37.41, 100, 137.5, 1000])(
    'at purchase %s it reports the real margin of the retail price it suggests, at the target',
    purchase => {
      // The margin the view shows is the suggested price's own, not one rebuilt from the
      // amounts rounded for display (#132).
      const r = calculateForward(purchase, PARAMS);
      expect(r.companyMargin).toBe(retailMargin(purchase, r.retailPrice, PARAMS));
      expect(r.companyMargin * 100).toBeGreaterThanOrEqual(PARAMS.optimalMargin);
      expect(classifyMargin(r.companyMargin * 100, PARAMS.optimalMargin)).toBe('green');
    }
  );

  it('refuses a purchase price whose raw retail price is out of range', () => {
    expect(() => calculateForward(1e15, PARAMS)).toThrow(/fuori dall'intervallo calcolabile/);
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

  it.each([9.9, 39.9])('refuses retail %s, which does not cover the fixed costs', retail => {
    // The chain's fixed costs (tools, transport, Italy costs) leave no positive purchase price:
    // a margin on a zero or negative one would read as a valid, even green, answer.
    expect(() => calculateInverse(retail, PARAMS)).toThrow(/non copre i costi fissi/);
  });

  it.each([59.9, 79.9, 129.9, 299.9, 1000])(
    'at retail %s it reports the real margin of the BT it suggests, at the target',
    retail => {
      // The largest tenth whose margin reaches the target: paying it keeps the target (#132).
      const r = calculateInverse(retail, PARAMS);
      expect(r.companyMargin).toBe(retailMargin(r.purchasePrice, retail, PARAMS));
      expect(r.companyMargin * 100).toBeGreaterThanOrEqual(PARAMS.optimalMargin);
      expect(classifyMargin(r.companyMargin * 100, PARAMS.optimalMargin)).toBe('green');
    }
  );
});

describe('calculateMarginOnly', () => {
  // The three modes must tell the same story on the same numbers: forward and inverse report the
  // margin of the prices they produce, the one a collection layout row shows for them.
  it.each([10, 37.41, 100, 137.5, 1000])(
    'agrees with forward on its purchase price %s and the retail price it suggests',
    purchase => {
      const forward = calculateForward(purchase, PARAMS);
      const margin = calculateMarginOnly(purchase, forward.retailPrice, PARAMS);

      expect(margin.companyMargin).toBe(forward.companyMargin);
      expect(margin.landedCost).toBe(forward.landedCost);
    }
  );

  it.each([59.9, 79.9, 129.9, 299.9, 1000])(
    'agrees with inverse on its retail price %s and the purchase price it suggests',
    retail => {
      const inverse = calculateInverse(retail, PARAMS);

      expect(calculateMarginOnly(inverse.purchasePrice, retail, PARAMS).companyMargin).toBe(
        inverse.companyMargin
      );
    }
  );

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
 * Every field of the three modes, pinned at two margins (52 %, 65 %). First captured before the
 * engine moved to core; moved since by #79 (`companyMargin` is the unrounded margin of the prices
 * each mode produces) and by #132 (the exact company multiplier, and the suggested retail price and
 * BT chosen to reach the target). A refactor of the chain must leave every one of them where it is.
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
        companyMultiplier: 2.0833333333333335,
        wholesalePrice: 304.69,
        retailPriceRaw: 792.19,
        retailPrice: 794.9,
        companyMargin: 0.5216379418794818,
        purchaseCurrency: 'CNY',
        sellingCurrency: 'EUR',
      },
      inverse: {
        mode: 'inverse',
        retailPrice: 299.9,
        wholesalePrice: 115.35,
        landedCost: 55.37,
        priceWithoutAccessories: 53.37,
        dutyCost: 3.95,
        priceWithoutDuty: 49.41,
        priceWithoutTransport: 50.37,
        qualityControlCost: 0.97,
        purchasePriceRaw: 48.39,
        purchasePrice: 48.3,
        companyMargin: 0.52086828942981,
        purchaseCurrency: 'CNY',
        sellingCurrency: 'EUR',
      },
      margin: {
        mode: 'margin',
        purchasePrice: 137.5,
        retailPrice: 299.9,
        landedCost: 146.25,
        wholesalePrice: 115.35,
        companyMargin: -0.2679226408802933,
        companyMultiplier: 2.0833333333333335,
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
        companyMultiplier: 2.857142857142857,
        wholesalePrice: 417.86,
        retailPriceRaw: 1086.43,
        retailPrice: 1089.9,
        companyMargin: 0.6511147811725847,
        purchaseCurrency: 'CNY',
        sellingCurrency: 'EUR',
      },
      inverse: {
        mode: 'inverse',
        retailPrice: 299.9,
        wholesalePrice: 115.35,
        landedCost: 40.37,
        priceWithoutAccessories: 38.37,
        dutyCost: 2.84,
        priceWithoutDuty: 35.53,
        priceWithoutTransport: 35.37,
        qualityControlCost: 0.67,
        purchasePriceRaw: 33.69,
        purchasePrice: 33.6,
        companyMargin: 0.6508596198732911,
        purchaseCurrency: 'CNY',
        sellingCurrency: 'EUR',
      },
      margin: {
        mode: 'margin',
        purchasePrice: 137.5,
        retailPrice: 299.9,
        landedCost: 146.25,
        wholesalePrice: 115.35,
        companyMargin: -0.2679226408802933,
        companyMultiplier: 2.857142857142857,
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

describe('the calculator and the collection layout row', () => {
  // A "CINA 8%" set (#79): retail 129.90 showed margin 51.9 in the calculator, 52.0 on the row.
  const CHINA_8: CalcParams = {
    qualityControlPercent: 5,
    transportInsuranceCost: 2.5,
    duty: 8,
    exchangeRate: 1.07,
    italyAccessoryCosts: 0.3,
    tools: 1,
    retailMultiplier: 2.48,
    optimalMargin: 52,
    purchaseCurrency: 'USD',
    sellingCurrency: 'EUR',
  };

  it('show the same BT, margin and status for the same retail price', () => {
    const inverse = calculateInverse(129.9, CHINA_8);

    expect(inverse.purchasePrice).toBe(20.1);
    // Shown as every view shows it, classified unrounded as every view does.
    expect(formatMarginPct(inverse.companyMargin)).toBe('52.0%');
    expect(classifyMargin(inverse.companyMargin * 100, CHINA_8.optimalMargin)).toBe('green');
  });
});
