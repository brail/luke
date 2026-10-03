import { describe, expect, it } from 'vitest';

import {
  calcMaxSupplierCost,
  classifyMargin,
  generateRetailPriceRange,
  landedCostBreakdown,
  priceForward,
  priceInverse,
  retailMargin,
} from '../pricing.js';

/** Hand-computable: 10 + 5 % QC + 1 tools = 11.5; + 2 = 13.5; + 10 % duty = 14.85; ÷ 1.1 + 1.5 = 15. */
const PS = {
  qualityControlPercent: 5,
  tools: 1,
  transportInsuranceCost: 2,
  duty: 10,
  exchangeRate: 1.1,
  italyAccessoryCosts: 1.5,
  retailMultiplier: 2.5,
};

describe('landedCostBreakdown', () => {
  it('walks every step of the chain', () => {
    const b = landedCostBreakdown(10, PS);
    expect(b.qualityControlCost).toBeCloseTo(0.5, 12);
    expect(b.priceWithQC).toBeCloseTo(11.5, 12);
    expect(b.priceWithTransport).toBeCloseTo(13.5, 12);
    expect(b.dutyCost).toBeCloseTo(1.35, 12);
    expect(b.priceWithDuty).toBeCloseTo(14.85, 12);
    expect(b.landedCost).toBeCloseTo(15, 12);
  });

  it('is the purchase price itself when every cost is zero', () => {
    const zero = { ...PS, qualityControlPercent: 0, tools: 0, transportInsuranceCost: 0, duty: 0, exchangeRate: 1, italyAccessoryCosts: 0 };
    expect(landedCostBreakdown(42, zero).landedCost).toBe(42);
  });

  it('agrees with the multiplicative duty form the consumers used to write', () => {
    // The chain is additive (`+ base × duty/100`, as forward mode reports `dutyCost`); five
    // callers wrote `base × (1 + duty/100)`. Equal in real arithmetic, they may differ in the
    // last ulp — a display rounding could then flip only on an exact .5 boundary.
    let seed = 20261003;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 2000; i++) {
      const ps = {
        qualityControlPercent: next() * 20,
        tools: next() * 5,
        transportInsuranceCost: next() * 10,
        duty: next() * 30,
        exchangeRate: 0.5 + next() * 1.5,
        italyAccessoryCosts: next() * 5,
      };
      const price = 1 + next() * 200;
      const withTransport = price + price * (ps.qualityControlPercent / 100) + ps.tools + ps.transportInsuranceCost;
      const multiplicative = (withTransport * (1 + ps.duty / 100)) / ps.exchangeRate + ps.italyAccessoryCosts;
      const additive = landedCostBreakdown(price, ps).landedCost;
      expect(Math.abs(additive - multiplicative) / multiplicative).toBeLessThan(1e-12);
    }
  });
});

describe('priceForward and priceInverse', () => {
  it('extends the landed-cost chain with the rounded company multiplier', () => {
    const ps = { ...PS, optimalMargin: 52 };
    const f = priceForward(10, ps);
    expect(f).toMatchObject(landedCostBreakdown(10, ps));
    expect(f.companyMultiplier).toBe(2.08);
    expect(f.wholesalePrice).toBeCloseTo(15 * 2.08, 10);
    expect(f.retailPriceRaw).toBeCloseTo(15 * 2.08 * 2.5, 10);
  });

  it('are each other\'s inverse over the whole chain, in order', () => {
    // A per-step check would pin the pieces, not the order they compose in — and the defect
    // fixed in R7i (QC divided away before the tools came out) was an order defect.
    let seed = 42;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 2000; i++) {
      const ps = {
        qualityControlPercent: next() * 20,
        tools: next() * 5,
        transportInsuranceCost: next() * 10,
        duty: next() * 30,
        exchangeRate: 0.5 + next() * 1.5,
        italyAccessoryCosts: next() * 5,
        retailMultiplier: 1.5 + next() * 2,
        optimalMargin: 30 + next() * 45,
      };
      const purchase = 1 + next() * 300;
      const back = priceInverse(priceForward(purchase, ps).retailPriceRaw, ps);
      expect(Math.abs(back.purchasePriceRaw - purchase) / purchase).toBeLessThan(1e-9);
      expect(back.qualityControlCost).toBeCloseTo(purchase * (ps.qualityControlPercent / 100), 9);
    }
  });
});

describe('calcMaxSupplierCost', () => {
  it('walks the landed-cost chain backwards: tools out, then QC', () => {
    // The retail price a purchase price reaches at the target margin; the inverse must give the
    // purchase price back (floored to 0.1). Undoing QC before tools — as if QC were charged on
    // tools too — came back short by tools × qc / (1 + qc).
    const ps = { ...PS, optimalMargin: 52 };
    // One cent above a tenth, so the floor cannot absorb a gap of a few cents.
    for (const purchase of [10.01, 37.41, 128.91]) {
      const retail = priceForward(purchase, ps).retailPriceRaw;
      expect(calcMaxSupplierCost(retail, ps)).toBe(Math.floor(purchase * 10) / 10);
    }
  });

  it('is the pricing page\'s inverse, floored: the multiplier the prices are made with', () => {
    // The BT used the exact multiplier 1 / (1 − m) (52 %: 2.0833…) while forward and the inverse
    // mode use it rounded (2.08): the same retail price gave two maximum costs.
    const ps = {
      qualityControlPercent: 2,
      tools: 1,
      transportInsuranceCost: 3,
      duty: 8,
      exchangeRate: 1.08,
      italyAccessoryCosts: 2,
      retailMultiplier: 2.6,
      optimalMargin: 52,
    };
    expect(calcMaxSupplierCost(79.9, ps)).toBe(8.6);
    for (const retail of generateRetailPriceRange()) {
      expect(calcMaxSupplierCost(retail, ps)).toBe(Math.floor(priceInverse(retail, ps).purchasePriceRaw * 10) / 10);
    }
  });
});

describe('retailMargin', () => {
  it('is wholesale less landed cost, over wholesale', () => {
    // Wholesale 100 / 2.5 = 40, landed 15: (40 − 15) / 40.
    expect(retailMargin(10, 100, PS)).toBeCloseTo(0.625, 12);
  });

  it('goes negative when the landed cost exceeds wholesale', () => {
    expect(retailMargin(10, 25, PS)).toBeCloseTo(-0.5, 12);
  });
});

describe('classifyMargin', () => {
  it.each([
    [52, 52, 'green'],
    [60, 52, 'green'],
    [51.999, 52, 'yellow'],
    [49, 52, 'yellow'],
    [48.999, 52, 'red'],
  ] as const)('%s %% against %s %% is %s', (pct, optimal, status) => {
    expect(classifyMargin(pct, optimal)).toBe(status);
  });
});
