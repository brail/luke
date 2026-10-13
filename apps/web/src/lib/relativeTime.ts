import { calendarDateIn, calendarDaysBetween, DEFAULT_LOCALE } from '@luke/core';

const RELATIVE_TIME = new Intl.RelativeTimeFormat(DEFAULT_LOCALE, { numeric: 'auto' });

/** Shown in place of a date while the reader zone is unknown. */
export const PENDING = '…';

/**
 * Formats `date` relative to now as text for the UI: `"ora"` within a minute, then minutes, hours
 * and days in the words `Intl` agrees with the number — `"5 minuti fa"`, `"1 ora fa"`, `"ieri"`.
 * Beyond 24 hours it counts calendar days in `timeZone` (the reader zone): 47 hours before 00:30 is
 * `"l’altro ieri"`, not `"ieri"`; on a 25-hour day an instant 24 hours away on the same day stays a
 * count of hours. Until the zone is known (`undefined`) a count of days is `"…"`. `date` counts as
 * past unless `ahead` is set (`"tra 5 minuti"`, `"domani"`): a server timestamp read on a browser
 * whose clock runs behind would otherwise come out in the future.
 */
export function formatRelativeTime(date: Date | string, timeZone: string | undefined, { ahead = false }: { ahead?: boolean } = {}): string {
  const instant = new Date(date);
  const now = new Date();
  const fromNow = instant.getTime() - now.getTime();
  const diffMs = ahead ? fromNow : Math.min(fromNow, 0);
  const sign = Math.sign(diffMs);
  const mins = Math.floor(Math.abs(diffMs) / 60_000);
  if (mins < 1) return 'ora';
  if (mins < 60) return RELATIVE_TIME.format(sign * mins, 'minute');
  const hours = Math.floor(mins / 60);
  if (hours < 24) return RELATIVE_TIME.format(sign * hours, 'hour');
  if (!timeZone) return PENDING;
  const days = calendarDaysBetween(calendarDateIn(now, timeZone), calendarDateIn(instant, timeZone));
  return days === 0 ? RELATIVE_TIME.format(sign * hours, 'hour') : RELATIVE_TIME.format(days, 'day');
}
