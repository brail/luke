import type { CalendarDate } from '@luke/core';

/**
 * localStorage key that marks the daily greeting as already seen on `day`, today in the profile
 * zone (the zone the greeting itself is written in).
 *
 * Lives in a dependency-free module — no `'use client'`, no tRPC, a type-only import — so it can
 * be imported both by the hook and by the Playwright process, which needs to suppress the modal
 * before it intercepts clicks. Duplicating this format elsewhere would mean that on the first
 * change (prefix, zone, version) the suppression silently stops working, and every smoke test
 * fails on a click blocked by a full-screen `Dialog`.
 */
export function dailyGreetingSeenKey(day: CalendarDate): string {
  return `luke-greeting-seen-${day}`;
}
