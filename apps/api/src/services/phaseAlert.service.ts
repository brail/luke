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

import {
  daysBetween,
  workingDaysBetween,
  CollectionAlertThresholdsSchema,
  type AlertBand,
  type CalendarDaysRelevance,
  type CollectionAlertThresholds,
  type WorkingDayHoliday,
} from '@luke/core';

import { getConfig } from '../lib/configManager';

import { resolveCompanyCountryCode } from './companyProfile.service';

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

// ─── Working-days deadline countdown (docs/TASK_working_days_calendar_relevance.md) ─────────────

/** Pre-fetched data shared across every day-count resolution in one request — company's home
 * country plus every `Holiday` row for any country code that could be needed (company + every
 * vendor country in scope). Built once per top-level call, not per row. */
interface WorkingDaysContext {
  companyCountryCode: string | null;
  holidays: WorkingDayHoliday[];
}

/** Empty context — used whenever nothing in scope has opted into working-days (the common case,
 * `calendarDaysRelevance` is null by default), so `buildWorkingDaysContext`'s 2 queries aren't
 * fired for nothing (`resolveDaysCount` ignores `ctx` entirely when `relevance` is null anyway). */
const EMPTY_WORKING_DAYS_CONTEXT: WorkingDaysContext = { companyCountryCode: null, holidays: [] };

/**
 * Builds the shared context for resolving working-days countdowns: the company's country plus
 * every `Holiday` row for the union of countries that could be needed (company + every distinct
 * vendor country passed in). One query regardless of how many rows/vendors are in scope. Callers
 * should only invoke this when something in scope actually has `calendarDaysRelevance` set —
 * otherwise use `EMPTY_WORKING_DAYS_CONTEXT` and skip the fetch entirely.
 */
async function buildWorkingDaysContext(
  prisma: PrismaClient,
  vendorCountryCodes: (string | null)[]
): Promise<WorkingDaysContext> {
  const companyCountryCode = await resolveCompanyCountryCode(prisma);
  const countryCodes = [...new Set([companyCountryCode, ...vendorCountryCodes].filter((c): c is string => !!c))];
  const holidays = countryCodes.length === 0 ? [] : await prisma.holiday.findMany({
    where: { countryCode: { in: countryCodes } },
    select: { countryCode: true, startDate: true, endDate: true },
  });
  return { companyCountryCode, holidays };
}

/**
 * Resolves the day count between two dates, honoring `relevance` when set: `null` keeps the
 * existing plain-calendar-days behavior (`daysBetween`, unchanged for every event not explicitly
 * opted in). When set, resolves the country list for the mode and switches to `workingDaysBetween`:
 * - `COMPANY` → `[companyCountryCode]`
 * - `VENDOR` → `[vendorCountryCode]`
 * - `BOTH` → both (a day only counts if it's a working day in *both* — `workingDaysBetween`
 *   excludes a date if it's a holiday in *either* listed country, which gives this for free)
 *
 * If the relevant country is unknown (company profile has no country set, or the row has no
 * vendor/the vendor has no country), degrades to weekend-only — `holidays: []` is passed
 * explicitly rather than `countryCodes: []`, because `isWorkingDay` treats an empty country list
 * as "apply every fetched holiday regardless of country," the opposite of what's wanted here.
 */
function resolveDaysCount(
  from: Date,
  to: Date,
  relevance: CalendarDaysRelevance | null,
  vendorCountryCode: string | null,
  ctx: WorkingDaysContext
): { days: number; daysMode: 'calendar' | 'working'; relevantCountryCodes: string[] } {
  if (!relevance) {
    return { days: daysBetween(from, to), daysMode: 'calendar', relevantCountryCodes: [] };
  }

  const countryCodes: string[] = [];
  if ((relevance === 'COMPANY' || relevance === 'BOTH') && ctx.companyCountryCode) {
    countryCodes.push(ctx.companyCountryCode);
  }
  if ((relevance === 'VENDOR' || relevance === 'BOTH') && vendorCountryCode) {
    countryCodes.push(vendorCountryCode);
  }

  if (countryCodes.length === 0) {
    return { days: workingDaysBetween(from, to, [], []), daysMode: 'working', relevantCountryCodes: [] };
  }

  return { days: workingDaysBetween(from, to, countryCodes, ctx.holidays), daysMode: 'working', relevantCountryCodes: countryCodes };
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
 * Resolves the deadline for an active-phase result: always the event's current `startAt`, live and
 * freely editable even after freeze. The frozen `baselineStartAt` is the fixed commitment used only
 * for `computeSchedulingVariance` (plan-vs-actual audit) — it must never feed the criticality
 * countdown, or rescheduling an event during the season would leave the alert pinned to a dead date
 * forever. No lead-time recompute. Pure — no I/O.
 */
function deadlineFromActivePhase(active: ActivePhaseResult) {
  if (active.status !== 'active') return null;
  return { event: active.event, deadline: active.event.startAt };
}

/**
 * Computes the criticality band for an active-phase result at a given point in time, against the
 * given thresholds. Pure — no I/O — so batch callers can reuse one `thresholds`/`workingDaysCtx`
 * fetch across rows.
 *
 * @param vendorCountryCode - The row's vendor country, if any (used only when the active event's
 *   `calendarDaysRelevance` is `VENDOR` or `BOTH`).
 * @param workingDaysCtx - Pre-fetched company country + holidays, from `buildWorkingDaysContext`.
 */
function criticalityFromActivePhase(
  rowId: string,
  active: ActivePhaseResult,
  thresholds: CollectionAlertThresholds,
  now: Date,
  vendorCountryCode: string | null,
  workingDaysCtx: WorkingDaysContext
) {
  const deadlineInfo = deadlineFromActivePhase(active);
  if (!deadlineInfo) return null;

  const { days: daysToDeadline, daysMode, relevantCountryCodes } = resolveDaysCount(
    now, deadlineInfo.deadline, deadlineInfo.event.calendarDaysRelevance, vendorCountryCode, workingDaysCtx
  );
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
    daysMode,
    relevantCountryCodes,
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
 *
 * Does its own row query (phase + vendor country in one shot) rather than delegating to
 * `getActivePhaseForRow` — that helper only selects `phase`, and a second `findUnique` just to
 * also get `vendor.countryCode` would be a redundant round-trip on the same row.
 */
export async function computeCriticality(rowId: string, now: Date, prisma: PrismaClient) {
  const [row, thresholds] = await Promise.all([
    prisma.collectionLayoutRow.findUnique({
      where: { id: rowId },
      select: { phase: { select: { order: true } }, vendor: { select: { countryCode: true } } },
    }),
    resolveAlertThresholds(prisma),
  ]);
  if (!row) return null;

  const events = await getApplicableEventsForRow(rowId, prisma);
  const active = getActivePhaseFromEvents(events, row.phase?.order ?? null);
  const vendorCountryCode = row.vendor?.countryCode ?? null;

  // Only fetch company country + holidays when the active event actually opted in — the common
  // case today (calendarDaysRelevance is null by default) skips both queries entirely.
  const workingDaysCtx = active.status === 'active' && active.event.calendarDaysRelevance
    ? await buildWorkingDaysContext(prisma, [vendorCountryCode])
    : EMPTY_WORKING_DAYS_CONTEXT;

  return criticalityFromActivePhase(rowId, active, thresholds, now, vendorCountryCode, workingDaysCtx);
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
      select: {
        id: true, planningGroupId: true, productCategory: true,
        phase: { select: { order: true } },
        vendor: { select: { countryCode: true } },
      },
    }),
    getCalendarEventsForLayout(collectionLayoutId, prisma),
    thresholds ? Promise.resolve(thresholds) : resolveAlertThresholds(prisma),
  ]);

  const rowActives = rows.map(row => ({
    row,
    active: getActivePhaseFromEvents(filterApplicableEvents(events, row.planningGroupId), row.phase?.order ?? null),
  }));

  // One working-days context for the whole batch (company country + every distinct vendor country
  // among these rows), instead of one per row — same batching principle as events/thresholds above.
  // Only fetched if at least one row's active event actually opted in (common case: none do).
  const needsWorkingDays = rowActives.some(({ active }) => active.status === 'active' && active.event.calendarDaysRelevance);
  const workingDaysCtx = needsWorkingDays
    ? await buildWorkingDaysContext(prisma, rows.map(r => r.vendor?.countryCode ?? null))
    : EMPTY_WORKING_DAYS_CONTEXT;

  return rowActives
    .map(({ row, active }) => {
      const criticality = criticalityFromActivePhase(
        row.id, active, resolvedThresholds, now, row.vendor?.countryCode ?? null, workingDaysCtx
      );
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
    select: { phaseId: true, vendor: { select: { countryCode: true } } },
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

  const vendorCountryCode = row.vendor?.countryCode ?? null;
  const workingDaysCtx = plannedEvent.calendarDaysRelevance
    ? await buildWorkingDaysContext(prisma, [vendorCountryCode])
    : EMPTY_WORKING_DAYS_CONTEXT;
  const { days: varianceDays, daysMode } = resolveDaysCount(
    plannedEvent.baselineStartAt, historyEntry.reachedAt, plannedEvent.calendarDaysRelevance, vendorCountryCode, workingDaysCtx
  );

  return {
    rowId,
    phaseId: row.phaseId,
    plannedDate: plannedEvent.baselineStartAt,
    actualDate: historyEntry.reachedAt,
    varianceDays,
    daysMode,
  };
}
