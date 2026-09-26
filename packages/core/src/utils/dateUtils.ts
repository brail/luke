/**
 * Returns the number of calendar days from `a` to `b` (positive when `b` is after `a`).
 * Calculation is UTC-based to avoid DST shifts.
 */
export function daysBetween(a: Date, b: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / msPerDay);
}

/**
 * Returns a new `Date` that is `days` calendar days after `date` (negative values go backward).
 * Does not mutate the input.
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * A holiday or closure period for a specific country, used to exclude non-working days
 * in `isWorkingDay` and `workingDaysBetween`.
 */
export interface WorkingDayHoliday {
  countryCode: string;
  startDate: Date;
  endDate: Date;
}

/**
 * Returns `true` if `date` is a working day — i.e. Monday–Friday and not covered by any
 * holiday period matching one of the specified `countryCodes`.
 *
 * @param countryCodes - If empty, holidays are applied regardless of country
 */
export function isWorkingDay(
  date: Date,
  countryCodes: string[],
  holidays: WorkingDayHoliday[],
): boolean {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return false;

  const utcDate = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  for (const h of holidays) {
    if (countryCodes.length > 0 && !countryCodes.includes(h.countryCode)) continue;
    const utcStart = Date.UTC(h.startDate.getFullYear(), h.startDate.getMonth(), h.startDate.getDate());
    const utcEnd   = Date.UTC(h.endDate.getFullYear(),   h.endDate.getMonth(),   h.endDate.getDate());
    if (utcDate >= utcStart && utcDate <= utcEnd) return false;
  }

  return true;
}

/**
 * `daysBetween` counting only working days: the dates from `from` (excluded) to `to` (included),
 * in either direction, time of day ignored. So the same date gives 0, and with no non-working day
 * in range the result equals `daysBetween`. Negative when `to` is before `from`. Respects holidays
 * for the given `countryCodes`.
 */
export function workingDaysBetween(
  from: Date,
  to: Date,
  countryCodes: string[],
  holidays: WorkingDayHoliday[],
): number {
  const days = daysBetween(from, to);
  const step = Math.sign(days);
  let count = 0;
  for (let i = 1; i <= Math.abs(days); i++) {
    if (isWorkingDay(addDays(from, step * i), countryCodes, holidays)) count++;
  }
  // `0 - count`, not `-count`: no working day backward must be 0, not -0.
  return days < 0 ? 0 - count : count;
}
