import { describe, expect, it } from 'vitest';

import {
  calcMaxSupplierCost,
  calculateCompanyMultiplier,
  classifyMargin,
  formatCompanyMultiplier,
  formatMarginPct,
  generateRetailPriceRange,
  isInPricingRange,
  landedCostBreakdown,
  meetsTargetMargin,
  priceForward,
  priceInverse,
  priceMargin,
  retailMargin,
  skuWeightedAverage,
  suggestRetailPrice,
  type InverseCalcParams,
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

/** The `k`-th commercial retail threshold, from 0: 9.9, 14.9, 19.9, … */
const threshold = (k: number) => (990 + 500 * k) / 100;

const ZERO_COSTS = {
  qualityControlPercent: 0,
  tools: 0,
  transportInsuranceCost: 0,
  duty: 0,
  exchangeRate: 1,
  italyAccessoryCosts: 0,
  retailMultiplier: 1,
};

const CHINA_52 = { qualityControlPercent: 2, tools: 1, transportInsuranceCost: 3, duty: 8, exchangeRate: 1.08, italyAccessoryCosts: 2, retailMultiplier: 2.6, optimalMargin: 52 };

/** The parameter sets the proposal rules are proved on: both target bounds, a CNY-like and a VND-like set. */
const SETS = {
  zeroCosts0: { ...ZERO_COSTS, optimalMargin: 0 },
  zeroCosts52: { ...ZERO_COSTS, optimalMargin: 52 },
  china52: CHINA_52,
  target65: { qualityControlPercent: 3, tools: 0.5, transportInsuranceCost: 1.2, duty: 12, exchangeRate: 1.1, italyAccessoryCosts: 1.5, retailMultiplier: 2.5, optimalMargin: 65 },
  target99_9: { ...CHINA_52, retailMultiplier: 2.5, optimalMargin: 99.9 },
  highFixedCosts: { qualityControlPercent: 5, tools: 8, transportInsuranceCost: 12, duty: 16, exchangeRate: 0.9, italyAccessoryCosts: 9, retailMultiplier: 2.6, optimalMargin: 52 },
  vnd: { qualityControlPercent: 2, tools: 20000, transportInsuranceCost: 50000, duty: 8, exchangeRate: 27000, italyAccessoryCosts: 2, retailMultiplier: 2.6, optimalMargin: 52 },
} satisfies Record<string, InverseCalcParams>;

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
  it('extends the landed-cost chain with the exact company multiplier', () => {
    const ps = { ...PS, optimalMargin: 52 };
    const f = priceForward(10, ps);
    expect(f).toMatchObject(landedCostBreakdown(10, ps));
    expect(f.companyMultiplier).toBe(1 / 0.48);
    expect(f.wholesalePrice).toBeCloseTo(15 / 0.48, 10);
    expect(f.retailPriceRaw).toBeCloseTo((15 / 0.48) * 2.5, 10);
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

  it('takes the largest tenth whose margin reaches the target, on every set', () => {
    // Margin, colour and maximality checked apart (#132): a check through the colour alone would
    // pass whatever tolerance the colour had.
    const bad: string[] = [];
    for (const [name, ps] of Object.entries(SETS)) {
      const retails = [...generateRetailPriceRange()];
      for (let k = 0; k < 400; k++) retails.push(threshold(k));
      // Retail prices whose raw BT lands exactly on a tenth, and just beside it.
      for (let k = 1; k < 3000; k++) {
        const r = priceForward(k / 10, ps).retailPriceRaw;
        retails.push(r, r + 1e-9, r - 1e-9);
      }
      for (const r of retails) {
        const bt = calcMaxSupplierCost(r, ps);
        if (bt === null) {
          if (meetsTargetMargin(0.1, r, ps)) bad.push(`${name} ${r}: null, yet 0.1 reaches the target`);
          continue;
        }
        const k = Math.round(bt * 10);
        if (bt !== k / 10 || k < 1) bad.push(`${name} ${r}: ${bt} is not a tenth`);
        if (retailMargin(bt, r, ps) * 100 < ps.optimalMargin) bad.push(`${name} ${r}: ${bt} below target`);
        if (classifyMargin(retailMargin(bt, r, ps) * 100, ps.optimalMargin) !== 'green') bad.push(`${name} ${r}: ${bt} not green`);
        // (k + 1) / 10, not bt + 0.1, which has float noise of its own.
        if (meetsTargetMargin((k + 1) / 10, r, ps)) bad.push(`${name} ${r}: ${bt} is not the largest`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('does not round a BT just under a tenth up to it (#132)', () => {
    // Raw BT 9.99999999995: the tenth 10 leaves 51.99999999976 %, below the target.
    expect(calcMaxSupplierCost(20.83333333322917, SETS.zeroCosts52)).toBe(9.9);
  });

  it('is null out of the supported range, never a throw: views and exports render it', () => {
    expect(calcMaxSupplierCost(1e16, SETS.china52)).toBeNull();
    // A raw BT far below zero is a retail price that does not cover the fixed costs: in range, null.
    expect(isInPricingRange(priceInverse(9.9, { ...SETS.china52, tools: 1e12 }).purchasePriceRaw)).toBe(true);
    expect(calcMaxSupplierCost(49.9, { ...SETS.china52, exchangeRate: 1e-300 })).toBeNull();
  });

  it('is null when the retail price does not cover the fixed costs', () => {
    // 9.9 at 2.6 → wholesale 3.81, landed 1.83: less than the 2 of Italy costs alone.
    const ps = { ...PS, optimalMargin: 52, italyAccessoryCosts: 2, retailMultiplier: 2.6 };
    expect(priceInverse(9.9, ps).purchasePriceRaw).toBeLessThan(0);
    expect(calcMaxSupplierCost(9.9, ps)).toBeNull();
  });
});

describe('priceMargin', () => {
  it('returns the margin with the landed cost and wholesale it was made of', () => {
    expect(priceMargin(10, 100, PS)).toEqual({
      landedCost: landedCostBreakdown(10, PS).landedCost,
      wholesalePrice: 40,
      companyMargin: retailMargin(10, 100, PS),
    });
  });
});

describe('skuWeightedAverage', () => {
  it('weights by SKU over the items that have one, ignoring the others', () => {
    // (80 × 1 + 20 × 3) / 4 = 35; the item with no SKU does not count.
    expect(skuWeightedAverage([{ value: 80, sku: 1 }, { value: 20, sku: 3 }, { value: 99, sku: null }])).toBe(35);
    expect(skuWeightedAverage([{ value: 80, sku: 1 }, { value: 20, sku: 3 }, { value: 99, sku: 0 }])).toBe(35);
  });

  it('falls back to the arithmetic mean when no item has a SKU', () => {
    expect(skuWeightedAverage([{ value: 80, sku: null }, { value: 20, sku: 0 }])).toBe(50);
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

describe('suggestRetailPrice', () => {
  // No costs and a 0 % target: the landed cost and the raw retail price are the purchase price,
  // and a threshold reaches the target exactly when it is at or above it.
  it.each([
    [0.5, 9.9],
    [9.9, 9.9],
    [9.91, 14.9],
    [12.4, 14.9],
    [40.1, 44.9],
    [44.9, 44.9],
    [44.95, 49.9],
    [52.43, 54.9],
    [102.45, 104.9],
  ])('rounds %s up to the first threshold, %s', (purchase, expected) => {
    expect(suggestRetailPrice(purchase, SETS.zeroCosts0)).toBe(expected);
  });

  it('takes the first threshold whose margin reaches the target, on every set', () => {
    const bad: string[] = [];
    for (const [name, ps] of Object.entries(SETS)) {
      const scale = Math.max(1, ps.exchangeRate);
      const purchases: number[] = [];
      for (let a = 0.5 * scale; a < 200 * scale; a += 0.37 * scale) purchases.push(a);
      // Purchase prices whose raw retail price lands exactly on a threshold, and just beside it.
      for (let k = 0; k < 120; k++) {
        const a = priceInverse(threshold(k), ps).purchasePriceRaw;
        purchases.push(a, a + 1e-9, a - 1e-9, a + 0.005, a - 0.005);
      }
      for (const a of purchases.filter(p => p > 0)) {
        const r = suggestRetailPrice(a, ps);
        const k = Math.round((r * 100 - 990) / 500);
        if (r !== threshold(k) || k < 0) bad.push(`${name} ${a}: ${r} is not a threshold`);
        if (retailMargin(a, r, ps) * 100 < ps.optimalMargin) bad.push(`${name} ${a}: ${r} below target`);
        if (classifyMargin(retailMargin(a, r, ps) * 100, ps.optimalMargin) !== 'green') bad.push(`${name} ${a}: ${r} not green`);
        // threshold(k − 1), not r − 5, which has float noise of its own (19.9 − 5 = 14.8999…).
        if (k > 0 && meetsTargetMargin(a, threshold(k - 1), ps)) bad.push(`${name} ${a}: ${r} is not the first`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('does not take a threshold just under the raw retail price (#132)', () => {
    // Raw 44.900000005: 44.9 leaves 51.99999999465 %, below the target.
    expect(suggestRetailPrice(21.5520000024, SETS.zeroCosts52)).toBe(49.9);
  });

  it('throws a RangeError out of the supported range', () => {
    expect(() => suggestRetailPrice(1e15, SETS.china52)).toThrow(RangeError);
    expect(() => suggestRetailPrice(10, { ...SETS.china52, exchangeRate: 1e-300 })).toThrow(RangeError);
  });
});

describe('calculateCompanyMultiplier and formatCompanyMultiplier', () => {
  it('is 1 / (1 − m), not rounded: 52 % is 2.0833…, not 2.08', () => {
    expect(calculateCompanyMultiplier(52)).toBe(1 / 0.48);
    expect(calculateCompanyMultiplier(0)).toBe(1);
  });

  it.each([
    [52, '×2.0833'],
    [65, '×2.8571'],
    [50, '×2.0000'],
  ])('shows %s %% as %s', (margin, shown) => {
    expect(formatCompanyMultiplier(calculateCompanyMultiplier(margin))).toBe(shown);
  });
});

describe('formatMarginPct', () => {
  it.each([
    [0.52, '52.0%'],
    [0.51996, '52.0%'],
    [0.51952, '52.0%'],
    [0.5194, '51.9%'],
    [0.4025, '40.3%'],
    [-0.2679, '-26.8%'],
  ])('%s → %s', (margin, shown) => {
    expect(formatMarginPct(margin)).toBe(shown);
  });
});

describe('classifyMargin', () => {
  it.each([
    [52, 52, 'green'],
    [60, 52, 'green'],
    [52 - 1e-12, 52, 'yellow'],
    [51.999, 52, 'yellow'],
    [49, 52, 'yellow'],
    [49 - 1e-12, 52, 'red'],
    [48.999, 52, 'red'],
  ] as const)('%s %% against %s %% is %s', (pct, optimal, status) => {
    expect(classifyMargin(pct, optimal)).toBe(status);
  });
});
