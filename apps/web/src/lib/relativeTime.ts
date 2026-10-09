const RELATIVE_TIME = new Intl.RelativeTimeFormat('it-IT', { numeric: 'auto' });

/**
 * Formats `date` relative to now as Italian text for the UI: `"ora"` within a minute, then minutes,
 * hours and days in the words `Intl` agrees with the number — `"5 minuti fa"`, `"1 ora fa"`,
 * `"ieri"`. `date` counts as past unless `ahead` is set (`"tra 5 minuti"`, `"domani"`): a server
 * timestamp read on a browser whose clock runs behind would otherwise come out in the future.
 */
export function formatRelativeTime(date: Date | string, { ahead = false }: { ahead?: boolean } = {}): string {
  const fromNow = new Date(date).getTime() - Date.now();
  const diffMs = ahead ? fromNow : Math.min(fromNow, 0);
  const sign = Math.sign(diffMs);
  const mins = Math.floor(Math.abs(diffMs) / 60_000);
  if (mins < 1) return 'ora';
  if (mins < 60) return RELATIVE_TIME.format(sign * mins, 'minute');
  const hours = Math.floor(mins / 60);
  if (hours < 24) return RELATIVE_TIME.format(sign * hours, 'hour');
  return RELATIVE_TIME.format(sign * Math.floor(hours / 24), 'day');
}
