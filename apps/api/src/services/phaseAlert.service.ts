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
  isWorkingDay,
  eventDeadline,
  CollectionAlertThresholdsSchema,
  type AlertBand,
  type AlertBandEmphasis,
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
    // `label` serve solo a `getMissingPhasesForCompletion`, che deve nominare le fasi saltate
    // all'utente: una colonna in più su una query già fatta, invece di una seconda lettura.
    phase: { select: { order: true; value: true; label: true; isActive: true } };
  };
}>;

/** Built-in bands used when `collectionControl.alertThresholds` has not been configured yet. */
const DEFAULT_ALERT_THRESHOLDS: CollectionAlertThresholds = {
  default: {
    // -Infinity fails z.number().int() and doesn't round-trip through JSON; a large negative
    // sentinel acts as "no lower bound" instead.
    bands: [
      // Emphasis climbs with severity so the built-in set already demonstrates the three visual
      // weights an admin can assign per band.
      { minDaysToDeadline: -9999, maxDaysToDeadline: 0, color: '#B91C1C', label: 'In ritardo', emphasis: 'solid' },
      { minDaysToDeadline: 0, maxDaysToDeadline: 7, color: '#D97706', label: 'Urgente', emphasis: 'soft' },
      { minDaysToDeadline: 7, maxDaysToDeadline: 21, color: '#CA8A04', label: 'Attenzione', emphasis: 'outline' },
      { minDaysToDeadline: 21, maxDaysToDeadline: null, color: '#15803D', label: 'In linea', emphasis: 'outline' },
    ],
  },
  completedBand: { color: '#15803D', label: 'Concluso', emphasis: 'solid' },
  completedLateBand: { color: '#B91C1C', label: 'Concluso in ritardo', emphasis: 'solid' },
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
    // Cancelled events are retired: they must never drive the criticality countdown nor the
    // scheduling-variance anchor. Filtered here at the single fetch shared by the per-row, batch
    // and variance paths so the exclusion is centralized (not duplicated per caller).
    where: { calendarId: calendar.id, cancelledAt: null },
    include: {
      phase: { select: { order: true, value: true, label: true, isActive: true } },
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
/** Whether a `calendarDaysRelevance` value makes the company's holiday calendar count. Shared by
 * `resolveDaysCount` (the deadline countdown) and `resolveHolidayOverlapsForGroup` (the freeze-time
 * warning) so the two can't drift on what each relevance mode means. */
function appliesToCompany(relevance: CalendarDaysRelevance): boolean {
  return relevance === 'COMPANY' || relevance === 'BOTH';
}

/** Whether a `calendarDaysRelevance` value makes a vendor's holiday calendar count — see `appliesToCompany`. */
function appliesToVendor(relevance: CalendarDaysRelevance): boolean {
  return relevance === 'VENDOR' || relevance === 'BOTH';
}

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
  if (appliesToCompany(relevance) && ctx.companyCountryCode) {
    countryCodes.push(ctx.companyCountryCode);
  }
  if (appliesToVendor(relevance) && vendorCountryCode) {
    countryCodes.push(vendorCountryCode);
  }

  if (countryCodes.length === 0) {
    return { days: workingDaysBetween(from, to, [], []), daysMode: 'working', relevantCountryCodes: [] };
  }

  return { days: workingDaysBetween(from, to, countryCodes, ctx.holidays), daysMode: 'working', relevantCountryCodes: countryCodes };
}

/** One event flagged as landing on a non-working day, for `resolveHolidayOverlapsForGroup`. */
export interface HolidayOverlapEntry {
  eventId: string;
  eventTitle: string;
  eventStartAt: Date;
  /** Which check tripped: a weekend date (checked first, independent of country), the company's
   * holiday calendar, or a vendor's — `vendorName` is set only for `'vendor'`. */
  reason: 'weekend' | 'company' | 'vendor';
  vendorName?: string;
}

/**
 * Flags, for every non-cancelled phase-tagged event in a planning group, whether it lands on a
 * non-working day per the *same* resolution `resolveDaysCount` uses for the deadline countdown
 * itself (company/vendor `Holiday` rows + weekend, by `calendarDaysRelevance`) — not the separate
 * `VendorClosurePeriod` concept used at event-creation time, which the deadline math never reads.
 * An event with `calendarDaysRelevance: null` is skipped entirely: its countdown isn't affected by
 * holidays, so an overlap here wouldn't mean anything.
 *
 * Purely informational (soft warning) — callers decide whether to let the user proceed regardless.
 * Rows with no vendor assigned simply don't contribute a vendor country — no error, no false alert.
 *
 * @returns One entry per (event, reason) — an event under `BOTH` can appear once for the company
 *   calendar and once per distinct vendor country among the group's rows.
 */
export async function resolveHolidayOverlapsForGroup(planningGroupId: string, prisma: PrismaClient): Promise<HolidayOverlapEntry[]> {
  const [events, rows] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { planningGroupId, cancelledAt: null, phaseId: { not: null }, calendarDaysRelevance: { not: null } },
      select: { id: true, title: true, startAt: true, calendarDaysRelevance: true },
    }),
    prisma.collectionLayoutRow.findMany({
      where: { planningGroupId, vendorId: { not: null } },
      select: { vendor: { select: { countryCode: true, name: true } } },
    }),
  ]);
  if (events.length === 0) return [];

  // Distinct vendor countries in scope, first vendor name per country kept only for the UI label.
  const vendorsByCountry = new Map<string, string>();
  for (const row of rows) {
    if (row.vendor?.countryCode && !vendorsByCountry.has(row.vendor.countryCode)) {
      vendorsByCountry.set(row.vendor.countryCode, row.vendor.name);
    }
  }

  const workingDaysCtx = await buildWorkingDaysContext(prisma, [...vendorsByCountry.keys()]);

  const overlaps: HolidayOverlapEntry[] = [];
  for (const event of events) {
    const flag = (reason: HolidayOverlapEntry['reason'], vendorName?: string) =>
      overlaps.push({ eventId: event.id, eventTitle: event.title, eventStartAt: event.startAt, reason, vendorName });

    // Empty countryCodes/holidays reduces isWorkingDay to a pure weekend check — same definition
    // of "weekend" the company/vendor checks below build on, no separate day-of-week logic here.
    if (!isWorkingDay(event.startAt, [], [])) {
      // Weekend already explains it regardless of relevance/country — skip the holiday checks
      // below, they'd just re-flag the same event for the same reason.
      flag('weekend');
      continue;
    }

    const relevance = event.calendarDaysRelevance!;
    if (appliesToCompany(relevance) && workingDaysCtx.companyCountryCode && !isWorkingDay(event.startAt, [workingDaysCtx.companyCountryCode], workingDaysCtx.holidays)) {
      flag('company');
    }
    if (appliesToVendor(relevance)) {
      for (const [countryCode, vendorName] of vendorsByCountry) {
        if (!isWorkingDay(event.startAt, [countryCode], workingDaysCtx.holidays)) {
          flag('vendor', vendorName);
        }
      }
    }
  }
  return overlaps;
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
 *
 * Events tied to a deactivated phase are skipped: `isActive: false` is a soft delete, and a retired
 * phase is out of the process — it must stop producing deadlines, not just disappear from pickers.
 * Same rule as `getNextPhaseFromEvents` and `getCompletionDeadlineEvent`, which already filtered it.
 * Consequence, deliberate: when no event on an active phase remains at or past the row's own phase,
 * the status is `completed`, `criticalityFromActivePhase` returns `null`, and the row leaves badge,
 * banner, heatmap, bottleneck and overdue notifications. Safe because `phase.remove` refuses to
 * retire a phase while open rows or live milestones still reference it.
 */
export function getActivePhaseFromEvents(rowEvents: CalendarEventWithContext[], currentOrder: number | null): ActivePhaseResult {
  if (rowEvents.length === 0) return { status: 'no-calendar' };
  const order = currentOrder ?? -Infinity;
  const event = rowEvents.find(e => e.phase?.isActive && e.phase.order >= order);
  return event ? { status: 'active', event } : { status: 'completed' };
}

/**
 * Resolves the phase after the active one — the next milestone the row will be measured against
 * once it clears the active phase's deadline. Pure — no I/O — operates on the same row-scoped,
 * phase.order-sorted array `getActivePhaseFromEvents` consumes.
 *
 * Skips events tied to a deactivated Phase (`phase.isActive === false`) — deactivating a phase
 * hides it from `phase.list` (the catalog the frontend resolves labels from), but doesn't retroactively
 * touch existing calendar events still referencing it. Surfacing one as "next phase" would show an
 * unresolvable label with no way for the user to act on it — closer to "nothing to show" than a
 * real next milestone.
 *
 * `null` when there's no active phase to look past, the active phase is the last one applicable to
 * this row, or every later event is tied to a deactivated phase.
 */
export function getNextPhaseFromEvents(rowEvents: CalendarEventWithContext[], active: ActivePhaseResult): CalendarEventWithContext | null {
  if (active.status !== 'active') return null;
  const activeOrder = active.event.phase?.order;
  if (activeOrder === undefined) return null;
  const activeIndex = rowEvents.findIndex(e => e.id === active.event.id);
  if (activeIndex === -1) return null;
  const next = rowEvents.slice(activeIndex + 1).find(e => e.phase && e.phase.order > activeOrder && e.phase.isActive);
  return next ?? null;
}

/**
 * The event a concluded row is measured against: the last applicable event tied to an *active*
 * phase. Deactivated phases are out of the process — `getNextPhaseFromEvents` already skips them —
 * so scoring a conclusion against a milestone of a retired phase would measure the row against work
 * that is no longer planned. Pure — no I/O — and relies on `filterApplicableEvents` having sorted
 * by `phase.order` (phase-less events land last, and are excluded here anyway).
 *
 * `null` when the row's planning group has no event tied to an active phase: nothing to compare a
 * completion date against, so the outcome carries no delta.
 */
export function getCompletionDeadlineEvent(rowEvents: CalendarEventWithContext[]): CalendarEventWithContext | null {
  const withActivePhase = rowEvents.filter(e => e.phase?.isActive);
  return withActivePhase.length > 0 ? withActivePhase[withActivePhase.length - 1] : null;
}

/**
 * Le fasi che la riga non ha ancora attraversato prima di potersi dire conclusa: quelle degli eventi
 * applicabili al suo gruppo di pianificazione, su fase attiva, con `order` maggiore di quello della
 * fase corrente. Stesso insieme che `getCompletionDeadlineEvent` percorre per scegliere la scadenza
 * dell'esito, così la regola resta una sola. Pure — no I/O.
 *
 * Concludere una riga che ne salta qualcuna non è vietato — sarebbe aggirabile in due click, e
 * produrrebbe un consuntivo tutto verde — ma va confermato esplicitamente e registrato: questo
 * elenco alimenta sia l'avviso nella UI sia `skippedPhases` nell'audit log.
 *
 * Vuoto quando la riga è già all'ultima milestone, o quando il gruppo non ha eventi di fase: senza
 * un termine di paragone non c'è nulla da segnalare. Riga senza fase (`currentOrder === null`) →
 * mancano tutte.
 *
 * @returns Fasi distinte, in ordine di percorrenza (più eventi sulla stessa fase contano una volta).
 */
export function getMissingPhasesForCompletion(
  rowEvents: CalendarEventWithContext[],
  currentOrder: number | null
): { value: string; label: string }[] {
  const order = currentOrder ?? -Infinity;
  const byValue = new Map<string, { value: string; label: string }>();

  for (const event of rowEvents) {
    if (!event.phase?.isActive || event.phase.order <= order) continue;
    if (!byValue.has(event.phase.value)) {
      byValue.set(event.phase.value, { value: event.phase.value, label: event.phase.label });
    }
  }

  return Array.from(byValue.values());
}

/**
 * DB-fetching counterpart di `getMissingPhasesForCompletion`. Condiviso fra l'anteprima che la UI
 * mostra prima di concludere e il guard della mutation, così i due non possono divergere: l'elenco
 * che l'utente conferma è lo stesso che il server pretende di forzare e registra nell'audit.
 *
 * @returns Vuoto se la riga non esiste — chi chiama sta già gestendo il NOT_FOUND per altra via.
 */
export async function resolveMissingPhasesForRow(rowId: string, prisma: PrismaClient) {
  const row = await prisma.collectionLayoutRow.findUnique({
    where: { id: rowId },
    select: { phase: { select: { order: true } } },
  });
  if (!row) return [];

  const events = await getApplicableEventsForRow(rowId, prisma);
  return getMissingPhasesForCompletion(events, row.phase?.order ?? null);
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
 * Resolves the deadline for an active-phase result: always the event's current `endAt ?? startAt`,
 * live and freely editable even after freeze. The frozen baseline (`baselineStartAt`/`baselineEndAt`,
 * written once by `freezePlanningGroup`) is a separate, fixed commitment — it must never feed the
 * criticality countdown, or rescheduling an event during the season would leave the alert pinned to
 * a dead date forever. No lead-time recompute. Pure — no I/O.
 */
function deadlineFromActivePhase(active: ActivePhaseResult) {
  if (active.status !== 'active') return null;
  return { event: active.event, deadline: eventDeadline(active.event) };
}

/**
 * Resolves the display fields for the row's next phase, at the same point in time / working-days
 * context as the active phase's own countdown. Pure — no I/O. Split out of `criticalityFromActivePhase`
 * so that function can take an early return instead of nesting this behind a ternary.
 */
function nextPhaseInfo(nextEvent: CalendarEventWithContext, now: Date, vendorCountryCode: string | null, workingDaysCtx: WorkingDaysContext) {
  const { days, daysMode, relevantCountryCodes } = resolveDaysCount(
    now, eventDeadline(nextEvent), nextEvent.calendarDaysRelevance, vendorCountryCode, workingDaysCtx
  );
  return {
    phaseId: nextEvent.phaseId,
    eventTitle: nextEvent.title,
    deadline: eventDeadline(nextEvent),
    daysUntil: days,
    daysMode,
    relevantCountryCodes,
  };
}

/**
 * Computes the criticality band for an active-phase result at a given point in time, against the
 * given thresholds. Pure — no I/O — so batch callers can reuse one `thresholds`/`workingDaysCtx`
 * fetch across rows.
 *
 * @param nextEvent - The row's next applicable event past `active`, already resolved by the caller
 *   via `getNextPhaseFromEvents` — every caller needs it anyway (to decide whether `workingDaysCtx`
 *   must be fetched), so it's passed in here instead of being recomputed from `rowEvents`.
 * @param vendorCountryCode - The row's vendor country, if any (used only when the active event's
 *   `calendarDaysRelevance` is `VENDOR` or `BOTH`).
 * @param workingDaysCtx - Pre-fetched company country + holidays, from `buildWorkingDaysContext`.
 */
function criticalityFromActivePhase(
  rowId: string,
  active: ActivePhaseResult,
  nextEvent: CalendarEventWithContext | null,
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
    state: 'active' as const,
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
    nextPhase: nextEvent ? nextPhaseInfo(nextEvent, now, vendorCountryCode, workingDaysCtx) : null,
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
 * Frozen outcome for a row the user explicitly marked as concluded: how its completion date landed
 * against the last planned milestone (`getCompletionDeadlineEvent`). Positive `daysVsDeadline` means
 * concluded ahead of the deadline, negative means after it — same sign convention as the live
 * `daysToDeadline`, and counted with the same calendar/working-days rules so the two are comparable.
 *
 * Pure — no I/O. No countdown: a concluded row has stopped moving, so the only thing left to say is
 * whether it made it. Recomputed from `completedAt` on every read rather than persisted, matching
 * `deadlineFromActivePhase`'s decision to always measure against the event's live date — rescheduling
 * a milestone after the fact re-scores the outcome instead of leaving it pinned to a dead date.
 */
export function completionOutcome(
  rowId: string,
  completedAt: Date,
  completionEvent: CalendarEventWithContext | null,
  thresholds: CollectionAlertThresholds,
  vendorCountryCode: string | null,
  workingDaysCtx: WorkingDaysContext
) {
  const deadline = completionEvent ? eventDeadline(completionEvent) : null;
  // Nessuna milestone di riferimento: resta la data di conclusione, senza delta inventato.
  const counted = completionEvent && deadline
    ? resolveDaysCount(completedAt, deadline, completionEvent.calendarDaysRelevance, vendorCountryCode, workingDaysCtx)
    : { days: null, daysMode: 'calendar' as const, relevantCountryCodes: [] as string[] };

  return {
    state: 'completed' as const,
    rowId,
    completedAt,
    eventId: completionEvent?.id ?? null,
    eventTitle: completionEvent?.title ?? null,
    deadline,
    daysVsDeadline: counted.days,
    daysMode: counted.daysMode,
    relevantCountryCodes: counted.relevantCountryCodes,
    // Senza scadenza contro cui misurarsi la conclusione non può essere in ritardo.
    band: counted.days === null || counted.days >= 0 ? thresholds.completedBand : thresholds.completedLateBand,
  };
}

/**
 * Computes the criticality band for a single row at a given point in time, against the configured
 * (or default) alert thresholds. `null` means no alert applies — the row has no active phase and
 * has not been marked as concluded.
 *
 * Does its own row query (phase + vendor country in one shot) rather than delegating to
 * `getActivePhaseForRow` — that helper only selects `phase`, and a second `findUnique` just to
 * also get `vendor.countryCode` would be a redundant round-trip on the same row.
 */
export async function computeCriticality(rowId: string, now: Date, prisma: PrismaClient) {
  const [row, thresholds] = await Promise.all([
    prisma.collectionLayoutRow.findUnique({
      where: { id: rowId },
      select: { completedAt: true, phase: { select: { order: true } }, vendor: { select: { countryCode: true } } },
    }),
    resolveAlertThresholds(prisma),
  ]);
  if (!row) return null;

  const events = await getApplicableEventsForRow(rowId, prisma);
  const vendorCountryCode = row.vendor?.countryCode ?? null;

  // Only fetch company country + holidays when the events involved actually opted in — the common
  // case today (calendarDaysRelevance is null by default) skips both queries entirely.
  const workingDaysContextFor = (...relevant: (CalendarEventWithContext | null)[]) =>
    relevant.some(e => e?.calendarDaysRelevance)
      ? buildWorkingDaysContext(prisma, [vendorCountryCode])
      : Promise.resolve(EMPTY_WORKING_DAYS_CONTEXT);

  // A concluded row has stopped moving: il suo esito congelato sostituisce il countdown qualunque
  // fase abbia raggiunto, quindi la fase attiva non viene nemmeno risolta.
  if (row.completedAt) {
    const completionEvent = getCompletionDeadlineEvent(events);
    const workingDaysCtx = await workingDaysContextFor(completionEvent);
    return completionOutcome(rowId, row.completedAt, completionEvent, thresholds, vendorCountryCode, workingDaysCtx);
  }

  const active = getActivePhaseFromEvents(events, row.phase?.order ?? null);
  const nextEvent = getNextPhaseFromEvents(events, active);
  const workingDaysCtx = await workingDaysContextFor(active.status === 'active' ? active.event : null, nextEvent);

  return criticalityFromActivePhase(rowId, active, nextEvent, thresholds, now, vendorCountryCode, workingDaysCtx);
}

/**
 * Computes the criticality band for every row in a layout with a single calendar/events fetch and
 * a single thresholds fetch, instead of once per row — the batch counterpart of `computeCriticality`
 * used by the Fase 6.1/6.2 dashboards.
 *
 * @param thresholds - Pass an already-resolved value when calling this for multiple layouts in the
 *   same request (e.g. `computeSaturationHeatmap`) — thresholds aren't layout-scoped, so refetching
 *   per layout would be redundant. Defaults to resolving them internally for single-layout callers.
 * @returns One entry per row that has an active phase or has been marked as concluded; rows with
 *   neither are omitted.
 */
export async function computeCriticalityForLayout(
  collectionLayoutId: string,
  now: Date,
  prisma: PrismaClient,
  thresholds?: CollectionAlertThresholds,
  options?: { activeOnly?: boolean }
) {
  const [rows, events, resolvedThresholds] = await Promise.all([
    prisma.collectionLayoutRow.findMany({
      // `activeOnly` esclude le righe concluse già in query, per i consumatori che le scarterebbero
      // comunque (l'indice di strozzatura): a fine stagione sono la maggioranza del layout, e
      // calcolarne l'esito per poi buttarlo è il lavoro più grosso che questo percorso può evitare.
      where: { collectionLayoutId, ...(options?.activeOnly ? { completedAt: null } : {}) },
      select: {
        id: true, planningGroupId: true, productCategory: true, completedAt: true,
        phase: { select: { order: true } },
        vendor: { select: { countryCode: true } },
      },
    }),
    getCalendarEventsForLayout(collectionLayoutId, prisma),
    thresholds ? Promise.resolve(thresholds) : resolveAlertThresholds(prisma),
  ]);

  // Gli eventi applicabili dipendono solo dal gruppo di pianificazione, non dalla riga: filtrarli e
  // riordinarli per ognuna delle centinaia di righe di un layout è lavoro moltiplicato per nulla —
  // e la heatmap lo moltiplica di nuovo per ogni brand della stagione.
  const eventsByPlanningGroup = new Map<string, CalendarEventWithContext[]>();
  const applicableEvents = (planningGroupId: string) => {
    let cached = eventsByPlanningGroup.get(planningGroupId);
    if (!cached) {
      cached = filterApplicableEvents(events, planningGroupId);
      eventsByPlanningGroup.set(planningGroupId, cached);
    }
    return cached;
  };

  // Una riga conclusa non viene più misurata contro la fase attiva, quindi non la si risolve
  // nemmeno: su un layout con molte righe chiuse è metà del lavoro per riga in meno.
  const resolved = rows.map(row => {
    const rowEvents = applicableEvents(row.planningGroupId);
    if (row.completedAt) {
      return { row, completedAt: row.completedAt, completionEvent: getCompletionDeadlineEvent(rowEvents) } as const;
    }
    const active = getActivePhaseFromEvents(rowEvents, row.phase?.order ?? null);
    return { row, completedAt: null, active, nextEvent: getNextPhaseFromEvents(rowEvents, active) } as const;
  });

  // One working-days context for the whole batch (company country + every distinct vendor country
  // among these rows), instead of one per row — same batching principle as events/thresholds above.
  // Only fetched if at least one row's events actually opted in (common case: none do).
  const needsWorkingDays = resolved.some(entry =>
    entry.completedAt
      ? Boolean(entry.completionEvent?.calendarDaysRelevance)
      : Boolean(
          (entry.active.status === 'active' && entry.active.event.calendarDaysRelevance)
          || entry.nextEvent?.calendarDaysRelevance
        )
  );
  const workingDaysCtx = needsWorkingDays
    ? await buildWorkingDaysContext(prisma, rows.map(r => r.vendor?.countryCode ?? null))
    : EMPTY_WORKING_DAYS_CONTEXT;

  return resolved
    .map(entry => {
      const vendorCountryCode = entry.row.vendor?.countryCode ?? null;
      // See `computeCriticality`: completion replaces the countdown, whatever phase the row is on.
      const criticality = entry.completedAt
        ? completionOutcome(entry.row.id, entry.completedAt, entry.completionEvent, resolvedThresholds, vendorCountryCode, workingDaysCtx)
        : criticalityFromActivePhase(entry.row.id, entry.active, entry.nextEvent, resolvedThresholds, now, vendorCountryCode, workingDaysCtx);
      return criticality ? { ...criticality, productCategory: entry.row.productCategory } : null;
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

  const cellCounts = new Map<string, { brandId: string; productCategory: string; label: string; color: string; emphasis: AlertBandEmphasis; count: number }>();

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
          emphasis: row.band.emphasis,
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
 *
 * Concluded rows are excluded: no event is holding them, so counting them here would inflate the
 * milestone they happened to stop on. They still appear in the saturation heatmap, which measures
 * where the collection stands rather than what is blocking it.
 */
export async function computeBottleneckByEvent(collectionLayoutId: string, now: Date, prisma: PrismaClient) {
  // `activeOnly` scarta le righe concluse in query invece che dopo averne calcolato l'esito.
  const rows = (await computeCriticalityForLayout(collectionLayoutId, now, prisma, undefined, { activeOnly: true }))
    .filter(r => r.state === 'active');

  const byEvent = new Map<string, {
    eventId: string; eventTitle: string; eventStartAt: Date;
    bands: Map<string, { label: string; color: string; emphasis: AlertBandEmphasis; count: number }>;
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
      eventEntry.bands.set(row.band.label, { label: row.band.label, color: row.band.color, emphasis: row.band.emphasis, count: 1 });
    }
  }

  return Array.from(byEvent.values())
    .map(e => ({ ...e, bands: Array.from(e.bands.values()) }))
    .sort((a, b) => a.eventStartAt.getTime() - b.eventStartAt.getTime());
}
