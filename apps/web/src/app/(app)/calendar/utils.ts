import {
  isEventDateLocked as isEventDateLockedCore,
  isEventDeleteLocked as isEventDeleteLockedCore,
} from '@luke/core';

import { type CalendarEventItem } from './_components/types';

/** Returns the Monday of the ISO week containing `d`, at midnight local time. */
export function mondayOf(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

/** Returns a new Date representing midnight (00:00:00) on the same local day as `d`. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Returns a new Date equal to `d` plus `n` calendar days. */
export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Returns the first day of the month `n` months after `d`. */
export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

/** Returns true when `a` and `b` fall on the same local calendar day. */
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Returns 'YYYY-MM-DD' in UTC — used as HolidayMap key. */
export function toUtcIsoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Days from a to b (positive = forward). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** Expands a start/end range (inclusive) into its UTC ISO ('YYYY-MM-DD') dates, one per day. */
export function expandDateRangeToIsoDates(start: Date, end: Date): string[] {
  const span = daysBetween(start, end);
  const dates: string[] = [];
  for (let i = 0; i <= span; i++) dates.push(toUtcIsoDate(addDays(start, i)));
  return dates;
}

/** Returns the ISO 8601 week number (1–53) for the given date. */
export function getIsoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

const PALETTE = [
  '#2563eb', // blue
  '#dc2626', // red
  '#16a34a', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#db2777', // pink
  '#0891b2', // cyan
  '#ea580c', // orange
  '#9333ea', // purple
  '#0d9488', // teal
  '#65a30d', // lime
  '#be123c', // rose
];

/**
 * Groups calendar events by day, returning one array per day in `days`.
 * An event appears in every day it overlaps (i.e. start ≤ dayEnd and end ≥ dayStart).
 */
export function groupEventsByDay<T extends { startAt: Date | string; endAt?: Date | string | null }>(
  events: T[],
  days: Date[],
): T[][] {
  return days.map(day => {
    const dayStart = day.getTime();
    const dayEnd = dayStart + 86_400_000 - 1;
    return events.filter(m => {
      const start = new Date(m.startAt).getTime();
      const end = m.endAt ? new Date(m.endAt).getTime() : start;
      return start <= dayEnd && end >= dayStart;
    });
  });
}

/**
 * Thin adapter over the shared `@luke/core` predicate — only reshapes the client's flattened
 * `planningGroupFrozenAt` field into `frozenAt`. The actual lock logic (frozen + phase-tagged +
 * deadline passed) lives in one place so this client-side UX mirror can't drift from the server's
 * enforcement (`apps/api/.../seasonCalendar.service.ts`).
 */
export function isEventDateLocked(m: Pick<CalendarEventItem, 'phaseId' | 'planningGroupFrozenAt' | 'startAt' | 'endAt'>): boolean {
  return isEventDateLockedCore({ phaseId: m.phaseId, frozenAt: m.planningGroupFrozenAt, startAt: m.startAt, endAt: m.endAt });
}

/** Thin adapter over the shared `@luke/core` predicate — see `isEventDateLocked` above. */
export function isEventDeleteLocked(m: Pick<CalendarEventItem, 'phaseId' | 'planningGroupFrozenAt'>): boolean {
  return isEventDeleteLockedCore({ phaseId: m.phaseId, frozenAt: m.planningGroupFrozenAt });
}

/**
 * Returns true when the current user may drag or edit a milestone.
 *
 * A milestone is editable when the user has `canUpdate`, the milestone either has no brandId or
 * belongs to the currently active brand, it is not cancelled (cancelled events are read-only until
 * an admin restores them), and it is not a date-locked frozen-past phase event (those move only via
 * the motivated reschedule flow, never via drag).
 *
 * @param canUpdate - `can('season_calendar:update')` result from `usePermission`.
 * @param activeBrandId - Currently selected brand from AppContext.
 */
export function canEditMilestone(
  m: { brandId?: string | null; phaseId?: string | null; planningGroupFrozenAt?: Date | string | null; startAt?: Date | string; endAt?: Date | string | null; cancelledAt?: Date | string | null },
  canUpdate: boolean | undefined,
  activeBrandId: string | undefined,
): boolean {
  if (!canUpdate || (m.brandId && m.brandId !== activeBrandId) || m.cancelledAt) return false;
  if (m.startAt !== undefined && isEventDateLocked({ phaseId: m.phaseId, planningGroupFrozenAt: m.planningGroupFrozenAt, startAt: m.startAt, endAt: m.endAt })) return false;
  return true;
}

/** Joins a milestone's visible functions into a comma-separated display string. */
export function formatVisibleFunctions(
  visibilities: { functionId: string }[],
  functionsById: Record<string, string>,
): string {
  return visibilities.map(v => functionsById[v.functionId] ?? v.functionId).join(', ');
}

/**
 * Derives a deterministic colour from a brand ID by hashing into the palette.
 * Use `assignBrandColors` when rendering a fixed set of brands for stable colours.
 */
export function brandColor(brandId: string): string {
  let hash = 0;
  for (let i = 0; i < brandId.length; i++) {
    hash = (hash * 31 + brandId.charCodeAt(i)) & 0xffffffff;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length]!;
}

/**
 * Assigns a stable colour from the palette to each brand by list index.
 * Preferred over `brandColor` when the full brand list is known upfront.
 */
export function assignBrandColors(brands: { id: string }[]): Record<string, string> {
  return Object.fromEntries(brands.map((b, i) => [b.id, PALETTE[i % PALETTE.length]!]));
}

/**
 * Resolves a brand's colour from `map`, falling back to `brandColor()` for
 * unknown IDs or to the CSS primary variable when `brandId` is nullish.
 */
export function resolveBrandColor(brandId: string | null | undefined, map: Record<string, string>): string {
  if (!brandId) return 'hsl(var(--primary))';
  return map[brandId] ?? brandColor(brandId);
}
