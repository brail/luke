import { wallClockDate } from './dateUtils.js';

/**
 * The time-of-day greeting at `instant` for a reader in `timeZone` (IANA): 05:00–11:59 Buongiorno,
 * 12:00–17:59 Buon pomeriggio, 18:00–04:59 Buonasera. One rule for the daily greeting and the
 * dashboard header. Throws a `RangeError` for an unknown zone, as `wallClockDate` does.
 */
export function greetingAt(instant: Date, timeZone: string): string {
  const hour = wallClockDate(instant, timeZone).getUTCHours();
  if (hour >= 5 && hour < 12) return 'Buongiorno';
  if (hour >= 12 && hour < 18) return 'Buon pomeriggio';
  return 'Buonasera';
}
