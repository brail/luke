import { instantAt, parseCalendarDate, sameTimeZone, type CalendarDate } from '@luke/core';

/** The zone this browser instance runs in (`vitest.browser.timezone.config.mts`). */
export const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The reader's profile zone, never the browser's (ADR-035): Rome, or Los Angeles where the browser
 * itself is in Rome. Each instance thus reads in a zone whose offset differs from its own.
 */
export const PROFILE = sameTimeZone(ZONE, 'Europe/Rome') ? 'America/Los_Angeles' : 'Europe/Rome';

/** `s` as a calendar date; a malformed fixture fails the test. */
export function date(s: string): CalendarDate {
  const parsed = parseCalendarDate(s);
  if (!parsed) throw new Error(`bad fixture date ${s}`);
  return parsed;
}

/** The instant the wall clock of `zone` reads `time` on `day`. */
export function at(day: string, time: string, zone = PROFILE): Date {
  return instantAt(date(day), time, zone);
}
