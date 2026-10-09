const RELATIVE_TIME = new Intl.RelativeTimeFormat('it', { numeric: 'auto' });

/**
 * Formats the time elapsed since `date` as an Italian relative-time string for display in the UI:
 * `"ora"` under a minute, then minutes, hours and days in the words `Intl` agrees with the number
 * (`"1 ora fa"`, `"ieri"`, `"5 giorni fa"`).
 */
export function formatRelativeTime(date: Date | string): string {
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60_000);
  if (mins < 1) return 'ora';
  if (mins < 60) return RELATIVE_TIME.format(-mins, 'minute');
  const hours = Math.floor(mins / 60);
  if (hours < 24) return RELATIVE_TIME.format(-hours, 'hour');
  return RELATIVE_TIME.format(-Math.floor(hours / 24), 'day');
}
