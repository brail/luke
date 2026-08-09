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
  it('centra il margine aziendale dichiarato nei parametri', () => {
    const result = calculateForward(100, PARAMS);

    // This is the parameter set's promise: `optimalMargin` isn't an aspiration,
    // it's what the company multiplier must produce. If one day they
    // diverge, the retail price no longer holds up the promised margin.
    expect(result.companyMargin * 100).toBeCloseTo(PARAMS.optimalMargin, 1);
  });

  it('il margine dipende solo da optimalMargin, non dal prezzo di acquisto', () => {
    const cheap = calculateForward(10, PARAMS);
    const expensive = calculateForward(1000, PARAMS);

    // The margin is a property of the parameter set. If it scales with the price,
    // someone has moved a fixed cost into the multiplicative part.
    expect(cheap.companyMargin).toBeCloseTo(expensive.companyMargin, 4);
  });

  it('la catena di costi è monotona: ogni step non riduce il prezzo', () => {
    const r = calculateForward(100, PARAMS);

    // With positive costs and percentages, no step can lower the value.
    // Catches an inverted sign at any point in the chain.
    expect(r.priceWithQC).toBeGreaterThanOrEqual(r.purchasePrice);
    expect(r.priceWithTransport).toBeGreaterThanOrEqual(r.priceWithQC);
    expect(r.priceWithDuty).toBeGreaterThanOrEqual(r.priceWithTransport);
    expect(r.wholesalePrice).toBeGreaterThan(r.landedCost);
    expect(r.retailPrice).toBeGreaterThan(r.wholesalePrice);
  });

  it('un prezzo di acquisto più alto produce un retail più alto', () => {
    // Monotonicity with respect to the input: trivial to verify, and the one thing
    // that distinguishes a pricing engine from a number generator.
    expect(calculateForward(200, PARAMS).retailPriceRaw).toBeGreaterThan(
      calculateForward(100, PARAMS).retailPriceRaw
    );
  });
});

describe('calculateInverse', () => {
  it('è l’inversa di calculateForward', () => {
    const purchasePrice = 137.5;
    const forward = calculateForward(purchasePrice, PARAMS);

    // Starting from `retailPriceRaw` and not `retailPrice`: the latter is
    // rounded to a psychological price, so the round trip couldn't close
    // exactly. The invariant concerns the calculation chain, not the
    // commercial rounding.
    const back = calculateInverse(forward.retailPriceRaw, PARAMS);

    expect(back.purchasePriceRaw).toBeCloseTo(purchasePrice, 1);
  });

  it('ricostruisce gli stessi valori intermedi del forward', () => {
    const forward = calculateForward(137.5, PARAMS);
    const back = calculateInverse(forward.retailPriceRaw, PARAMS);

    expect(back.wholesalePrice).toBeCloseTo(forward.wholesalePrice, 1);
    expect(back.landedCost).toBeCloseTo(forward.landedCost, 1);
    expect(back.companyMargin).toBeCloseTo(forward.companyMargin, 3);
  });

  it('arrotonda il prezzo di acquisto per difetto', () => {
    const back = calculateInverse(1000, PARAMS);

    // Rounding the maximum payable price up would erode the margin:
    // the rounding direction is a commercial choice, not a
    // numerical detail.
    expect(back.purchasePrice).toBeLessThanOrEqual(back.purchasePriceRaw);
  });
});

describe('calculateMarginOnly', () => {
  it('conferma il margine dichiarato quando i prezzi vengono dal forward', () => {
    const forward = calculateForward(100, PARAMS);
    const margin = calculateMarginOnly(100, forward.retailPriceRaw, PARAMS);

    // The three modes must tell the same story on the same numbers.
    expect(margin.companyMargin).toBeCloseTo(forward.companyMargin, 3);
    expect(margin.landedCost).toBeCloseTo(forward.landedCost, 1);
  });

  it('un retail più basso a parità di costo comprime il margine', () => {
    const full = calculateMarginOnly(100, 800, PARAMS);
    const discounted = calculateMarginOnly(100, 600, PARAMS);

    expect(discounted.companyMargin).toBeLessThan(full.companyMargin);
  });

  it('segnala margine negativo quando il retail non copre il costo', () => {
    // Edge case that really matters: selling below cost must produce a
    // negative number, not an error or a silent zero.
    const result = calculateMarginOnly(100, 150, PARAMS);

    expect(result.companyMargin).toBeLessThan(0);
  });
});
