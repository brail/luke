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
