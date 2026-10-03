/**
 * Pricing parameter set values required for inverse and margin calculations.
 * All percentage fields (e.g. `optimalMargin`, `duty`) are expressed as 0–100 numbers.
 */
export interface InverseCalcParams {
  retailMultiplier: number;
  optimalMargin: number;
  italyAccessoryCosts: number;
  duty: number;
  exchangeRate: number;
  transportInsuranceCost: number;
  qualityControlPercent: number;
  tools: number;
}

/** The parameter set fields the forward landed-cost chain reads. */
export type LandedCostParams = Pick<
  InverseCalcParams,
  'qualityControlPercent' | 'tools' | 'transportInsuranceCost' | 'duty' | 'exchangeRate' | 'italyAccessoryCosts'
>;

/** Every step of the forward landed-cost chain, in the currency each step is in. */
export interface LandedCostBreakdown {
  qualityControlCost: number;
  priceWithQC: number;
  priceWithTransport: number;
  dutyCost: number;
  priceWithDuty: number;
  /** In the selling currency, Italy accessory costs included. */
  landedCost: number;
}

/**
 * The landed cost of a purchase price, step by step: quality control (a percentage of the
 * price) and tools, then transport and insurance, then duty (a percentage of that), then the
 * conversion to the selling currency (÷ exchange rate) plus the Italy accessory costs.
 *
 * The one spelling of the chain: forward mode returns these steps, every margin reads
 * `landedCost`.
 */
export function landedCostBreakdown(purchasePrice: number, ps: LandedCostParams): LandedCostBreakdown {
  const qualityControlCost = purchasePrice * (ps.qualityControlPercent / 100);
  const priceWithQC = purchasePrice + qualityControlCost + ps.tools;
  const priceWithTransport = priceWithQC + ps.transportInsuranceCost;
  const dutyCost = priceWithTransport * (ps.duty / 100);
  const priceWithDuty = priceWithTransport + dutyCost;
  const landedCost = priceWithDuty / ps.exchangeRate + ps.italyAccessoryCosts;
  return { qualityControlCost, priceWithQC, priceWithTransport, dutyCost, priceWithDuty, landedCost };
}

/** Margin mode's values, unrounded. */
export interface MarginBreakdown {
  /** Forward from the purchase price. */
  landedCost: number;
  /** Backward from the retail price: retail ÷ retail multiplier. */
  wholesalePrice: number;
  /** (wholesale − landed) / wholesale, a fraction. */
  companyMargin: number;
}

/**
 * The company margin a retail price leaves over a purchase price (margin mode): the landed cost
 * forward from one, the wholesale backward from the other, and the margin between them.
 *
 * Not forward mode's margin, whose wholesale is landed cost × company multiplier. No guards:
 * callers decide what a missing or non-positive price means, and a zero wholesale is theirs to
 * rule out.
 */
export function priceMargin(
  purchasePrice: number,
  retailPrice: number,
  ps: LandedCostParams & Pick<InverseCalcParams, 'retailMultiplier'>
): MarginBreakdown {
  const { landedCost } = landedCostBreakdown(purchasePrice, ps);
  const wholesalePrice = retailPrice / ps.retailMultiplier;
  return { landedCost, wholesalePrice, companyMargin: (wholesalePrice - landedCost) / wholesalePrice };
}

/** `priceMargin`'s margin alone, for the callers that only average it. */
export function retailMargin(
  purchasePrice: number,
  retailPrice: number,
  ps: LandedCostParams & Pick<InverseCalcParams, 'retailMultiplier'>
): number {
  return priceMargin(purchasePrice, retailPrice, ps).companyMargin;
}

/** The margin target of a view that has no parameter set to read one from. */
export const DEFAULT_OPTIMAL_MARGIN = 52;

/**
 * The mean of `value`, weighted by SKU over the items whose SKU is positive; the arithmetic mean
 * when none is. How a row's quotations combine into one margin or one retail price, on screen and
 * in the exports alike. `items` must not be empty.
 */
export function skuWeightedAverage(items: ReadonlyArray<{ value: number; sku: number | null }>): number {
  const withSku = items.filter(i => i.sku !== null && i.sku > 0);
  if (withSku.length > 0) {
    const totalSku = withSku.reduce((s, i) => s + (i.sku ?? 0), 0);
    return withSku.reduce((s, i) => s + i.value * (i.sku ?? 0), 0) / totalSku;
  }
  return items.reduce((s, i) => s + i.value, 0) / items.length;
}

/** Every value of forward mode, unrounded: the landed-cost chain, then the two multipliers. */
export interface ForwardBreakdown extends LandedCostBreakdown {
  /** `calculateCompanyMultiplier(optimalMargin)`, rounded to 2 decimals as every mode uses it. */
  companyMultiplier: number;
  wholesalePrice: number;
  retailPriceRaw: number;
  /** (wholesale − landed) / wholesale: the target margin, give or take the multiplier's rounding. */
  companyMargin: number;
}

/** The retail price a purchase price reaches at the target margin, every step (forward mode). */
export function priceForward(purchasePrice: number, ps: InverseCalcParams): ForwardBreakdown {
  const breakdown = landedCostBreakdown(purchasePrice, ps);
  const companyMultiplier = calculateCompanyMultiplier(ps.optimalMargin);
  const wholesalePrice = breakdown.landedCost * companyMultiplier;
  return {
    ...breakdown,
    companyMultiplier,
    wholesalePrice,
    retailPriceRaw: wholesalePrice * ps.retailMultiplier,
    companyMargin: (wholesalePrice - breakdown.landedCost) / wholesalePrice,
  };
}

/** Every value of inverse mode, unrounded. `dutyCost` is in the selling currency here. */
export interface InverseBreakdown {
  companyMultiplier: number;
  wholesalePrice: number;
  landedCost: number;
  priceWithoutAccessories: number;
  priceWithoutDuty: number;
  dutyCost: number;
  priceWithoutTransport: number;
  qualityControlCost: number;
  purchasePriceRaw: number;
  companyMargin: number;
}

/**
 * The largest purchase price a retail price allows at the target margin, every step (inverse
 * mode): the forward chain undone — the two multipliers, the Italy costs, the duty (still in the
 * selling currency), the exchange and the transport, then the tools and the quality control. Tools
 * come out before QC is divided away: QC is a percentage of the purchase price alone.
 *
 * `priceForward` and this function must stay each other's inverse; a full-chain round-trip test pins
 * it.
 */
export function priceInverse(retailPrice: number, ps: InverseCalcParams): InverseBreakdown {
  const companyMultiplier = calculateCompanyMultiplier(ps.optimalMargin);
  const wholesalePrice = retailPrice / ps.retailMultiplier;
  const landedCost = wholesalePrice / companyMultiplier;
  const priceWithoutAccessories = landedCost - ps.italyAccessoryCosts;
  const priceWithoutDuty = priceWithoutAccessories / (1 + ps.duty / 100);
  const priceWithoutTransport = priceWithoutDuty * ps.exchangeRate - ps.transportInsuranceCost;
  const purchasePriceRaw = (priceWithoutTransport - ps.tools) / (1 + ps.qualityControlPercent / 100);
  return {
    companyMultiplier,
    wholesalePrice,
    landedCost,
    priceWithoutAccessories,
    priceWithoutDuty,
    dutyCost: priceWithoutAccessories - priceWithoutDuty,
    priceWithoutTransport,
    qualityControlCost: purchasePriceRaw * (ps.qualityControlPercent / 100),
    purchasePriceRaw,
    companyMargin: (wholesalePrice - landedCost) / wholesalePrice,
  };
}

/** How a margin compares with its target. */
export type MarginStatus = 'green' | 'yellow' | 'red';

/**
 * Classifies a margin percentage against the target one: at or above it green, within three
 * points below it yellow, red under that. Both are 0–100 numbers, compared unrounded.
 */
export function classifyMargin(marginPct: number, optimalMargin: number): MarginStatus {
  if (marginPct >= optimalMargin) return 'green';
  if (marginPct >= optimalMargin - 3) return 'yellow';
  return 'red';
}

/**
 * Derives the company multiplier from the target margin percentage.
 *
 * @example calculateCompanyMultiplier(52) // → 2.08
 */
export function calculateCompanyMultiplier(optimalMargin: number): number {
  return Math.round((1 / (1 - optimalMargin / 100)) * 100) / 100;
}

/**
 * The maximum acceptable FOB supplier cost (the BT) for a retail target price: inverse mode's
 * purchase price, floored to one decimal — paying more would erode the margin.
 */
export function calcMaxSupplierCost(retailPrice: number, ps: InverseCalcParams): number {
  return Math.floor(priceInverse(retailPrice, ps).purchasePriceRaw * 10) / 10;
}

/**
 * Generates an array of commercial retail price points from `min` to `max` stepping by `step`.
 *
 * @example generateRetailPriceRange(39.9, 99.9, 10) // [39.9, 49.9, 59.9, 69.9, 79.9, 89.9, 99.9]
 */
export function generateRetailPriceRange(min = 39.9, max = 499.9, step = 10): number[] {
  const prices: number[] = [];
  let p = min;
  while (p <= max + 0.001) {
    prices.push(Math.round(p * 10) / 10);
    p += step;
  }
  return prices;
}

/**
 * Rounds a raw price to the nearest commercial retail threshold (`.9` or `.4`).
 *
 * @example
 * roundRetailPrice(21.43) // → 19.9
 * roundRetailPrice(45.60) // → 44.9
 * roundRetailPrice(67.80) // → 69.9
 */
export function roundRetailPrice(price: number): number {
  if (price < 10) return 9.9;

  const integerPart = Math.floor(price);
  const decimalPart = price - integerPart;
  const tens = Math.floor(integerPart / 10) * 10;
  const finalPart = (integerPart % 10) + decimalPart;

  if (finalPart >= 0.0 && finalPart <= 2.4) {
    return Math.max(9.9, tens - 10 + 9.9);
  } else if (finalPart >= 2.5 && finalPart <= 7.4) {
    return tens + 4.9;
  } else {
    return tens + 9.9;
  }
}
