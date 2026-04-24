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

/** Calcola il moltiplicatore aziendale dal margine target (es. 52% → 2.083). */
export function calculateCompanyMultiplier(optimalMargin: number): number {
  return Math.round((1 / (1 - optimalMargin / 100)) * 100) / 100;
}

/** Calcola il massimo costo FOB fornitore dato un prezzo retail target. */
export function calcMaxSupplierCost(retailPrice: number, ps: InverseCalcParams): number {
  const cm = 1 / (1 - ps.optimalMargin / 100);
  const wholesale = retailPrice / ps.retailMultiplier;
  const landed = wholesale / cm;
  const withoutAcc = landed - ps.italyAccessoryCosts;
  const withoutDuty = withoutAcc / (1 + ps.duty / 100);
  const withoutTransport = withoutDuty * ps.exchangeRate - ps.transportInsuranceCost;
  const raw = withoutTransport / (1 + ps.qualityControlPercent / 100) - ps.tools;
  return Math.floor(raw * 10) / 10;
}

/** Genera range di prezzi retail commerciali (es. 39.9, 49.9, ... 499.9). */
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
 * Commercial rounding for retail prices.
 * Rounds to the nearest .9 or .4 threshold.
 * Examples: 21.43 → 19.9 | 45.60 → 44.9 | 67.80 → 69.9
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
