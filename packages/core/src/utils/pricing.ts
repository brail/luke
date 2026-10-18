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
 * Every view's margin, the calculator's forward and inverse modes included: they apply it to the
 * prices they produce (the suggested retail price, the BT), not to the unrounded chain. No guards:
 * callers decide what a missing or non-positive price means, and a zero wholesale is theirs to rule
 * out.
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
  /** `calculateCompanyMultiplier(optimalMargin)`, exact. */
  companyMultiplier: number;
  wholesalePrice: number;
  retailPriceRaw: number;
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
 * A margin fraction as every view shows it: a percentage rounded to one decimal. For display only:
 * `classifyMargin` reads the unrounded value.
 */
export function roundMarginPct(margin: number): number {
  return Math.round(margin * 1000) / 10;
}

/** `roundMarginPct` as text: `0.51996` → `52.0%`. */
export function formatMarginPct(margin: number): string {
  return `${roundMarginPct(margin).toFixed(1)}%`;
}

/**
 * Derives the company multiplier from the target margin percentage: `1 / (1 − m)`, exact, so every
 * chain builds on the target as the parameter set states it. It used to be rounded to 2 decimals
 * (52 % → 2.08 → 51.92 %), and the calculator's own proposals missed the target.
 *
 * @example calculateCompanyMultiplier(52) // → 2.0833…
 */
export function calculateCompanyMultiplier(optimalMargin: number): number {
  return 1 / (1 - optimalMargin / 100);
}

/** A company multiplier as every view shows it: four decimals. `2.0833…` → `×2.0833`. */
export function formatCompanyMultiplier(multiplier: number): string {
  return `×${multiplier.toFixed(4)}`;
}

/**
 * Whether the margin a retail price leaves over a purchase price reaches the target, decided as
 * every per-quotation view colours it: `classifyMargin` on `retailMargin`, in double, with no
 * tolerance. Forward and inverse mode choose their prices with it, so what they propose is green
 * wherever it is shown, edge cases included. A tie in exact arithmetic is decided by the double.
 */
export function meetsTargetMargin(purchasePrice: number, retailPrice: number, ps: InverseCalcParams): boolean {
  return classifyMargin(retailMargin(purchasePrice, retailPrice, ps) * 100, ps.optimalMargin) === 'green';
}

/**
 * The largest raw price, retail or BT and in its own currency, the proposals accept. The schemas
 * set no maximum on prices or on the exchange rate: past this, the integer steps below lose
 * precision in a double, or the chain overflows to Infinity or NaN. Far above any real price, in
 * any currency.
 */
const MAX_RAW_PRICE = 1e9;

/**
 * Whether a raw price is inside the range the proposals accept (`MAX_RAW_PRICE`). Bounded above
 * only: a negative raw BT is a retail price that does not cover the fixed costs, not one out of range.
 */
export function isInPricingRange(raw: number): boolean {
  return Number.isFinite(raw) && raw < MAX_RAW_PRICE;
}

/** The `k`-th commercial retail threshold, from 0: 9.90, 14.90, 19.90, … — every price ending in 4.90 or 9.90. */
function retailThreshold(k: number): number {
  return (990 + 500 * k) / 100;
}

/**
 * The retail price forward mode proposes for a purchase price: the first commercial threshold
 * (9.90, 14.90, 19.90, …) whose margin reaches the target (`meetsTargetMargin`). In exact
 * arithmetic that is the first threshold at or above the raw retail price; in double it can sit a
 * few ulps below it, with its margin still at the target. Never below 9.90.
 *
 * @throws {RangeError} When the raw retail price is not finite or not below `MAX_RAW_PRICE`.
 */
export function suggestRetailPrice(purchasePrice: number, ps: InverseCalcParams): number {
  const raw = priceForward(purchasePrice, ps).retailPriceRaw;
  if (!isInPricingRange(raw)) throw new RangeError(`Raw retail price out of range: ${raw}`);
  const meets = (k: number) => meetsTargetMargin(purchasePrice, retailThreshold(k), ps);
  // The candidate the raw price gives, then at most two steps either way: the margin grows with the
  // retail price, so the first threshold reaching the target is unique, and the double rounding of
  // `raw` moves the candidate by one step at most.
  let k = Math.max(0, Math.ceil((raw * 100 - 990) / 500));
  for (let i = 0; i < 2 && k > 0 && meets(k - 1); i++) k--;
  for (let i = 0; i < 2 && !meets(k); i++) k++;
  if (!meets(k) || (k > 0 && meets(k - 1))) {
    throw new Error(`No first retail threshold reaching the target near ${raw}`);
  }
  return retailThreshold(k);
}

/**
 * The maximum acceptable FOB supplier cost (the BT) for a retail price: the largest tenth whose
 * margin reaches the target (`meetsTargetMargin`) — paying more would erode the margin. `null`
 * when not even 0.1 does (the retail price does not cover the fixed costs), or when the raw BT is
 * out of range. Views and exports render it, so it never throws.
 */
export function calcMaxSupplierCost(retailPrice: number, ps: InverseCalcParams): number | null {
  const raw = priceInverse(retailPrice, ps).purchasePriceRaw;
  if (!isInPricingRange(raw)) return null;
  const meets = (k: number) => meetsTargetMargin(k / 10, retailPrice, ps);
  // As in `suggestRetailPrice`: the candidate, then at most two steps either way; the margin falls
  // as the purchase price grows. Checked in full: inside the range the property tests pin it.
  let k = Math.max(0, Math.floor(raw * 10));
  for (let i = 0; i < 2 && meets(k + 1); i++) k++;
  for (let i = 0; i < 2 && k > 0 && !meets(k); i++) k--;
  return k > 0 && meets(k) && !meets(k + 1) ? k / 10 : null;
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
