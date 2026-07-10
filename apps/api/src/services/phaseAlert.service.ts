/**
 * Phase/calendar resolution shared between the planning group UI and the alert engine (Fase 5).
 * No graph traversal: for a given row, statically filters the events of its season calendar down
 * to those sharing its planningGroupId.
 *
 * Split into DB-fetching functions (per row or per layout) and pure functions operating on
 * already-fetched data, so batch callers (e.g. a whole layout's criticality) can fetch the
 * calendar/events/thresholds once and reuse them across rows instead of refetching per row.
 */

import pino from 'pino';

import { daysBetween, CollectionAlertThresholdsSchema, type AlertBand, type CollectionAlertThresholds } from '@luke/core';

import { getConfig } from '../lib/configManager';

import type { Prisma, PrismaClient } from '@prisma/client';

const logger = pino({ level: 'info' });

type CalendarEventWithContext = Prisma.CalendarEventGetPayload<{
  include: {
    phase: { select: { order: true; value: true } };
  };
}>;

/** Built-in bands used when `collectionControl.alertThresholds` has not been configured yet. */
const DEFAULT_ALERT_THRESHOLDS: CollectionAlertThresholds = {
  default: {
    // -Infinity fails z.number().int() and doesn't round-trip through JSON; a large negative
    // sentinel acts as "no lower bound" instead.
    bands: [
      { minDaysToDeadline: -9999, maxDaysToDeadline: 0, color: '#B91C1C', label: 'In ritardo' },
      { minDaysToDeadline: 0, maxDaysToDeadline: 7, color: '#D97706', label: 'Urgente' },
      { minDaysToDeadline: 7, maxDaysToDeadline: 21, color: '#CA8A04', label: 'Attenzione' },
      { minDaysToDeadline: 21, maxDaysToDeadline: null, color: '#15803D', label: 'In linea' },
    ],
  },
};

/**
 * Returns every calendar event for the season calendar backing a collection layout (unfiltered by
 * planning group — use `filterApplicableEvents` to scope down to a specific row's group). Fetched
 * once per layout so batch callers avoid re-resolving the same calendar/events per row.
 *
 * @returns Empty array if the layout has no season calendar yet.
 */
export async function getCalendarEventsForLayout(
  collectionLayoutId: string,
  prisma: PrismaClient
): Promise<CalendarEventWithContext[]> {
  const layout = await prisma.collectionLayout.findUnique({
    where: { id: collectionLayoutId },
    select: { brandId: true, seasonId: true },
  });
  if (!layout) return [];

  const calendar = await prisma.seasonCalendar.findUnique({
    where: { brandId_seasonId: { brandId: layout.brandId, seasonId: layout.seasonId } },
    select: { id: true },
  });
  if (!calendar) return [];

  return prisma.calendarEvent.findMany({
    where: { calendarId: calendar.id },
    include: {
      phase: { select: { order: true, value: true } },
    },
    // Fetched pre-sorted by startAt: Array.prototype.sort is stable, so events sharing the
    // same Phase.order below keep this chronological order as a secondary sort key.
    orderBy: { startAt: 'asc' },
  });
}

/**
 * Scopes a layout's events down to those applicable to one row, ordered by Phase.order.
 * Pure — no I/O — so it can run per row over an already-fetched events array.
 *
 * Resolution rule: an event applies to a row iff they share the same planningGroupId — planning
 * groups fully decouple event scope from row scope, no per-event anchor list needed.
 */
export function filterApplicableEvents(events: CalendarEventWithContext[], planningGroupId: string): CalendarEventWithContext[] {
  const applicable = events.filter(event => event.planningGroupId === planningGroupId);
  return applicable.sort((a, b) => (a.phase?.order ?? Infinity) - (b.phase?.order ?? Infinity));
}

/**
 * Returns the calendar events that apply to a given collection row. Single-row convenience
 * wrapper — for a whole layout, call `getCalendarEventsForLayout` once and reuse it with
 * `filterApplicableEvents` per row instead of calling this in a loop.
 *
 * @returns Empty array if the row's layout has no season calendar yet.
 */
export async function getApplicableEventsForRow(rowId: string, prisma: PrismaClient): Promise<CalendarEventWithContext[]> {
  const row = await prisma.collectionLayoutRow.findUnique({
    where: { id: rowId },
    select: { collectionLayoutId: true, planningGroupId: true },
  });
  if (!row) return [];

  const events = await getCalendarEventsForLayout(row.collectionLayoutId, prisma);
  return filterApplicableEvents(events, row.planningGroupId);
}

/**
 * Reads and validates `collectionControl.alertThresholds` from AppConfig, falling back to
 * `DEFAULT_ALERT_THRESHOLDS` if the key is unset, malformed, or fails validation (never throws).
 */
export async function resolveAlertThresholds(prisma: PrismaClient): Promise<CollectionAlertThresholds> {
  const raw = await getConfig(prisma, 'collectionControl.alertThresholds', false);
  if (!raw) return DEFAULT_ALERT_THRESHOLDS;
  try {
    const parsed = CollectionAlertThresholdsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_ALERT_THRESHOLDS;
  } catch (error) {
    logger.warn({ err: error }, 'Failed to parse AppConfig collectionControl.alertThresholds');
    return DEFAULT_ALERT_THRESHOLDS;
  }
}

/**
 * Picks the band set for a phase: its override if configured, else the global default.
 * Keyed by `Phase.value` (the stable business key), not `Phase.id` — a generated UUID that
 * differs per environment/seed and would silently stop matching if config were copied across environments.
 */
function bandsForPhase(thresholds: CollectionAlertThresholds, phaseValue: string | null): AlertBand[] {
  if (phaseValue && thresholds.perPhaseOverride?.[phaseValue]) {
    return thresholds.perPhaseOverride[phaseValue].bands;
  }
  return thresholds.default.bands;
}

/** Outcome of resolving a row's active phase — distinguishes "nothing to alert on" from why. */
export type ActivePhaseResult =
  | { status: 'active'; event: CalendarEventWithContext }
  /** Row already reached (or passed) every applicable phase — done, no alert needed. */
  | { status: 'completed' }
  /** The row's layout has no season calendar (or no applicable events) yet. */
  | { status: 'no-calendar' };

/**
 * Resolves the phase the row is measured against — the "active" milestone — from an
 * already-fetched, row-scoped events array. Pure — no I/O.
 *
 * A calendar event tagged with phase X means "X must be completed (the row must move past it) by
 * this date". So the active event is the first one whose phase order is >= the row's current
 * phase order (`>=`, not `>`): while the row sits *at* phase X, X's own deadline still applies —
 * it hasn't been completed yet, only reached. Once the row advances past X, that event stops
 * being relevant and the next one takes over.
 *
 * A row with no phase yet (`currentOrder === null`) is treated as before the first phase — the
 * first applicable event becomes active, matching "riga non ancora arrivata alla prima fase".
 */
export function getActivePhaseFromEvents(rowEvents: CalendarEventWithContext[], currentOrder: number | null): ActivePhaseResult {
  if (rowEvents.length === 0) return { status: 'no-calendar' };
  const order = currentOrder ?? -Infinity;
  const event = rowEvents.find(e => e.phase && e.phase.order >= order);
  return event ? { status: 'active', event } : { status: 'completed' };
}

/** DB-fetching counterpart of `getActivePhaseFromEvents` for single-row callers. */
export async function getActivePhaseForRow(rowId: string, prisma: PrismaClient): Promise<ActivePhaseResult> {
  const row = await prisma.collectionLayoutRow.findUnique({
    where: { id: rowId },
    select: { phase: { select: { order: true } } },
  });
  if (!row) return { status: 'no-calendar' };

  const events = await getApplicableEventsForRow(rowId, prisma);
  return getActivePhaseFromEvents(events, row.phase?.order ?? null);
}

/**
 * Resolves the deadline for an active-phase result: the frozen baseline date if the calendar has
 * been congelato, otherwise the event's current (freely-editable) startAt. No lead-time recompute.
 * Pure — no I/O.
 */
function deadlineFromActivePhase(active: ActivePhaseResult) {
  if (active.status !== 'active') return null;
  return { event: active.event, deadline: active.event.baselineStartAt ?? active.event.startAt };
}

/**
 * Computes the criticality band for an active-phase result at a given point in time, against the
 * given thresholds. Pure — no I/O — so batch callers can reuse one `thresholds` fetch across rows.
 */
function criticalityFromActivePhase(rowId: string, active: ActivePhaseResult, thresholds: CollectionAlertThresholds, now: Date) {
  const deadlineInfo = deadlineFromActivePhase(active);
  if (!deadlineInfo) return null;

  const daysToDeadline = daysBetween(now, deadlineInfo.deadline);
  const bands = bandsForPhase(thresholds, deadlineInfo.event.phase?.value ?? null);
  const band = bands.find(b => daysToDeadline >= b.minDaysToDeadline && (b.maxDaysToDeadline === null || daysToDeadline < b.maxDaysToDeadline))
    ?? bands[bands.length - 1];

  return {
    rowId,
    eventId: deadlineInfo.event.id,
    eventTitle: deadlineInfo.event.title,
    eventStartAt: deadlineInfo.event.startAt,
    phaseId: deadlineInfo.event.phaseId,
    deadline: deadlineInfo.deadline,
    daysToDeadline,
    band,
  };
}

/**
 * Resolves the deadline for a single row's active phase (see `deadlineFromActivePhase`).
 *
 * @returns `null` if the row has no active phase.
 */
export async function computeDeadline(rowId: string, prisma: PrismaClient) {
  const active = await getActivePhaseForRow(rowId, prisma);
  return deadlineFromActivePhase(active);
}

/**
 * Computes the criticality band for a single row at a given point in time, against the configured
 * (or default) alert thresholds. `null` means no alert applies — the row has no active phase.
 */
export async function computeCriticality(rowId: string, now: Date, prisma: PrismaClient) {
  const active = await getActivePhaseForRow(rowId, prisma);
  const thresholds = await resolveAlertThresholds(prisma);
  return criticalityFromActivePhase(rowId, active, thresholds, now);
}

/**
 * Computes the criticality band for every row in a layout with a single calendar/events fetch and
 * a single thresholds fetch, instead of once per row — the batch counterpart of `computeCriticality`
 * used by the Fase 6.1/6.2 dashboards.
 *
 * @param thresholds - Pass an already-resolved value when calling this for multiple layouts in the
 *   same request (e.g. `computeSaturationHeatmap`) — thresholds aren't layout-scoped, so refetching
 *   per layout would be redundant. Defaults to resolving them internally for single-layout callers.
 * @returns One entry per row that has an active phase; rows with no active phase are omitted.
 */
export async function computeCriticalityForLayout(
  collectionLayoutId: string,
  now: Date,
  prisma: PrismaClient,
  thresholds?: CollectionAlertThresholds
) {
  const [rows, events, resolvedThresholds] = await Promise.all([
    prisma.collectionLayoutRow.findMany({
      where: { collectionLayoutId },
      select: { id: true, planningGroupId: true, productCategory: true, phase: { select: { order: true } } },
    }),
    getCalendarEventsForLayout(collectionLayoutId, prisma),
    thresholds ? Promise.resolve(thresholds) : resolveAlertThresholds(prisma),
  ]);

  return rows
    .map(row => {
      const rowEvents = filterApplicableEvents(events, row.planningGroupId);
      const active = getActivePhaseFromEvents(rowEvents, row.phase?.order ?? null);
      const criticality = criticalityFromActivePhase(row.id, active, resolvedThresholds, now);
      return criticality ? { ...criticality, productCategory: row.productCategory } : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

/**
 * Saturation heatmap data (Fase 6.1): counts rows per criticality band, grouped by brand and
 * product category, across every brand's collection layout for the given season. Brands with no
 * layout yet are skipped.
 */
export async function computeSaturationHeatmap(
  seasonId: string,
  brandIds: string[],
  now: Date,
  prisma: PrismaClient
) {
  const [layouts, thresholds] = await Promise.all([
    prisma.collectionLayout.findMany({
      where: { seasonId, brandId: { in: brandIds } },
      select: { id: true, brandId: true },
    }),
    resolveAlertThresholds(prisma),
  ]);

  const perLayoutRows = await Promise.all(
    layouts.map(layout => computeCriticalityForLayout(layout.id, now, prisma, thresholds).then(rows => ({ layout, rows })))
  );

  const cellCounts = new Map<string, { brandId: string; productCategory: string; label: string; color: string; count: number }>();

  for (const { layout, rows } of perLayoutRows) {
    for (const row of rows) {
      const key = `${layout.brandId}::${row.productCategory}::${row.band.label}`;
      const existing = cellCounts.get(key);
      if (existing) {
        existing.count++;
      } else {
        cellCounts.set(key, {
          brandId: layout.brandId,
          productCategory: row.productCategory,
          label: row.band.label,
          color: row.band.color,
          count: 1,
        });
      }
    }
  }

  return Array.from(cellCounts.values());
}

/**
 * Bottleneck index (Fase 6.2): for a single layout, counts rows per criticality band grouped by
 * their active event — identifies which specific milestone is holding up the most rows.
 */
export async function computeBottleneckByEvent(collectionLayoutId: string, now: Date, prisma: PrismaClient) {
  const rows = await computeCriticalityForLayout(collectionLayoutId, now, prisma);

  const byEvent = new Map<string, {
    eventId: string; eventTitle: string; eventStartAt: Date;
    bands: Map<string, { label: string; color: string; count: number }>;
  }>();

  for (const row of rows) {
    let eventEntry = byEvent.get(row.eventId);
    if (!eventEntry) {
      eventEntry = { eventId: row.eventId, eventTitle: row.eventTitle, eventStartAt: row.eventStartAt, bands: new Map() };
      byEvent.set(row.eventId, eventEntry);
    }
    const bandEntry = eventEntry.bands.get(row.band.label);
    if (bandEntry) {
      bandEntry.count++;
    } else {
      eventEntry.bands.set(row.band.label, { label: row.band.label, color: row.band.color, count: 1 });
    }
  }

  return Array.from(byEvent.values())
    .map(e => ({ ...e, bands: Array.from(e.bands.values()) }))
    .sort((a, b) => a.eventStartAt.getTime() - b.eventStartAt.getTime());
}

/**
 * Compares the frozen baseline date for the row's *current* phase (the "in teoria" plan) against
 * the date the row actually reached that phase per `CollectionRowPhaseHistory` (the "in verità"
 * outcome) — the plan-vs-actual scheduling variance requested alongside Fase 2's freeze/baseline.
 *
 * @returns `null` if the row has no current phase, the calendar is not frozen, or the row has no
 *   history entry for that phase yet.
 */
export async function computeSchedulingVariance(rowId: string, prisma: PrismaClient) {
  const row = await prisma.collectionLayoutRow.findUnique({
    where: { id: rowId },
    select: { phaseId: true },
  });
  if (!row?.phaseId) return null;

  const events = await getApplicableEventsForRow(rowId, prisma);
  const plannedEvent = events.find(event => event.phaseId === row.phaseId);
  if (!plannedEvent?.baselineStartAt) return null;

  const historyEntry = await prisma.collectionRowPhaseHistory.findFirst({
    where: { rowId, phaseId: row.phaseId },
    orderBy: { reachedAt: 'desc' },
  });
  if (!historyEntry) return null;

  return {
    rowId,
    phaseId: row.phaseId,
    plannedDate: plannedEvent.baselineStartAt,
    actualDate: historyEntry.reachedAt,
    varianceDays: daysBetween(plannedEvent.baselineStartAt, historyEntry.reachedAt),
  };
}
