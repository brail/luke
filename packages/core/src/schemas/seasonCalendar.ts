import { z } from 'zod';

import { calendarDaysBetween } from '../utils/dateUtils.js';

import { CalendarDateSchema, CalendarInstantSchema } from './dates.js';
import { MandatoryReasonSchema } from './reason.js';

/** The fields of a vendor closure, unrefined so the dialog can pick from them (Zod 4 refuses `.pick`
 * on a refined object). */
export const VendorClosureUpsertBaseSchema = z.object({
  id:          z.uuid().optional(),
  vendorId:    z.uuid(),
  seasonId:    z.uuid(),
  countryCode: z.string().length(2).nullable(),
  name:        z.string().min(1, 'Il nome è obbligatorio').max(200, 'Massimo 200 caratteri'),
  startDate:   CalendarDateSchema,
  endDate:     CalendarDateSchema,
  type:        z.enum(['CLOSURE', 'OPEN']),
  notes:       z.string().max(500, 'Massimo 500 caratteri').nullable().optional(),
});

/** A closure's last day is not before its first; the dialog applies it too, for the message on the
 * end date. */
export const VendorClosureDaysInOrder = z.refine<{ startDate: string; endDate: string }>(value => value.endDate >= value.startDate, {
  path: ['endDate'],
  message: 'La data di fine non può precedere quella di inizio',
});

/** What `holidays.upsertVendorClosure` accepts, for both create and update — a vendor closure or
 * open-day period within a season, shown while events are placed; the working-day math does not
 * read it (`docs/country-aware-working-days.md`). Its days are calendar days, the last included. */
export const VendorClosureUpsertInputSchema = VendorClosureUpsertBaseSchema.check(VendorClosureDaysInOrder);
export type VendorClosureUpsertInput = z.infer<typeof VendorClosureUpsertInputSchema>;

/**
 * The answer of Nager.Date's `GET /api/v3/PublicHolidays/{year}/{countryCode}`, the fields the
 * holiday import reads: an external source, so its days are checked as calendar days where they are
 * read (ADR-035 §Bounds).
 */
export const NagerHolidaysSchema = z.array(z.object({
  date: CalendarDateSchema,
  localName: z.string().nullish(),
  name: z.string().min(1),
}));

// ─── Const arrays ─────────────────────────────────────────────────────────────

/** Lifecycle statuses for a season calendar. `ARCHIVED` calendars are read-only. */
export const SEASON_CALENDAR_STATUS = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type SeasonCalendarStatus = (typeof SEASON_CALENDAR_STATUS)[number];

/**
 * Which holiday calendar(s) count toward an event's working-days deadline countdown. Unset means
 * the countdown stays in plain calendar days (default, opt-in only). See
 * docs/country-aware-working-days.md for the full design and resolution rules.
 */
export const CALENDAR_DAYS_RELEVANCE = ['COMPANY', 'VENDOR', 'BOTH'] as const;
export type CalendarDaysRelevance = (typeof CALENDAR_DAYS_RELEVANCE)[number];

// ─── CalendarEvent input ──────────────────────────────────────────────────────

/** Base fields shared by calendar event create and update inputs. */
export const CalendarEventBaseSchema = z.object({
  planningGroupId:              z.uuid(),
  phaseId:                      z.uuid().optional().nullable(),
  calendarDaysRelevance:        z.enum(CALENDAR_DAYS_RELEVANCE).optional().nullable(),
  title:                        z.string().min(1).max(200),
  startAt:                      CalendarInstantSchema,
  description:                  z.string().max(2000).optional(),
  endAt:                        CalendarInstantSchema.optional(),
  allDay:                       z.boolean().default(false),
  publishExternally:            z.boolean().default(true),
  templateItemId:               z.uuid().optional(),
  visibilityFunctionIds:        z.array(z.uuid()).min(1, 'Seleziona almeno una funzione'),
});

export type CalendarEventInput = z.infer<typeof CalendarEventBaseSchema>;

/** What a calendar notification link opens: an event, or a calendar (`calendarLink`). */
export const CalendarLinkTargetSchema = z.union([
  z.object({ eventId: z.uuid() }),
  z.object({ calendarId: z.uuid() }),
]);

export type CalendarLinkTarget = z.infer<typeof CalendarLinkTargetSchema>;

/**
 * The `/calendar` link of a calendar notice: its event (`?event=`), else its calendar
 * (`?calendar=`), else the page as it stands. `calendarLinkTargetOf` reads it back.
 */
export function calendarLink(target: { eventId?: string; calendarId?: string }): string {
  if (target.eventId) return `/calendar?event=${encodeURIComponent(target.eventId)}`;
  if (target.calendarId) return `/calendar?calendar=${encodeURIComponent(target.calendarId)}`;
  return '/calendar';
}

/**
 * The target a `/calendar` URL carries (`calendarLink`), or `null`; not validated — the server
 * refuses one that is not a target (`CalendarLinkTargetSchema`).
 */
export function calendarLinkTargetOf(params: { get(name: string): string | null }): CalendarLinkTarget | null {
  const eventId = params.get('event');
  if (eventId) return { eventId };
  const calendarId = params.get('calendar');
  return calendarId ? { calendarId } : null;
}

/** The longest range, in days, a digest can be re-sent for (`CalendarDigestRangeInputSchema`). */
export const CALENDAR_DIGEST_MAX_DAYS = 31;

/**
 * Inclusive date range for a manually triggered calendar digest.
 *
 * The ordering check lives here rather than in the dialog: an inverted range is not a UI slip, it
 * produces an empty recap that the server would otherwise mail out without complaint.
 */
export const CalendarDigestRangeInputSchema = z
  .object({
    from: CalendarDateSchema,
    to: CalendarDateSchema,
  })
  .refine(value => value.to >= value.from, {
    path: ['to'],
    message: 'La data finale non può precedere quella iniziale',
  })
  // A digest re-sent on request rebuilds every change in the range from the audit log: bounded.
  .refine(value => calendarDaysBetween(value.from, value.to) < CALENDAR_DIGEST_MAX_DAYS, {
    path: ['to'],
    message: `Al massimo ${CALENDAR_DIGEST_MAX_DAYS} giorni`,
  });
export type CalendarDigestRangeInput = z.infer<typeof CalendarDigestRangeInputSchema>;

// ─── Milestone lifecycle inputs ───────────────────────────────────────────────

/**
 * The dates a client read and based a write on. The write lands only if the event still holds
 * them, so a move computed from a stale list, or saved from a form left open, cannot silently undo
 * a move someone else made in between: the caller gets a CONFLICT and reloads. Required on every
 * write that can move an event, so no caller can forget it.
 */
export const EventDatesExpectedSchema = z.object({
  startAt: CalendarInstantSchema,
  endAt: CalendarInstantSchema.nullable(),
  allDay: z.boolean(),
});
export type EventDatesExpected = z.infer<typeof EventDatesExpectedSchema>;

/**
 * Motivated in-place move of a milestone's dates — the only way past `isEventDateLocked`, so the
 * reason is the whole point of the endpoint rather than a courtesy. The baseline is deliberately
 * not a field: a reschedule must not rewrite what scheduling variance is measured against.
 */
export const MilestoneRescheduleInputSchema = z.object({
  id: z.uuid(),
  startAt: CalendarInstantSchema,
  endAt: CalendarInstantSchema.optional().nullable(),
  allDay: z.boolean().optional(),
  reason: MandatoryReasonSchema,
  expected: EventDatesExpectedSchema,
});
export type MilestoneRescheduleInput = z.infer<typeof MilestoneRescheduleInputSchema>;

/** Retiring a milestone instead of deleting it: the event stays in history, with its reason. */
export const MilestoneCancelInputSchema = z.object({
  id: z.uuid(),
  reason: MandatoryReasonSchema,
});
export type MilestoneCancelInput = z.infer<typeof MilestoneCancelInputSchema>;

// ─── Planning group input ─────────────────────────────────────────────────────

/** Input schema for creating or renaming a PlanningGroup within a SeasonCalendar. */
export const PlanningGroupInputSchema = z.object({
  name: z.string().min(1).max(100),
});
export type PlanningGroupInput = z.infer<typeof PlanningGroupInputSchema>;

/** Input schema for applying a milestone template to a planning group. `calendarId` is derived
 * server-side from `planningGroupId` — never accepted directly, to avoid a mismatched pair. The
 * anchor is the calendar day the items' offsets count from. */
export const ApplyTemplateInputSchema = z.object({
  planningGroupId: z.uuid(),
  templateId:      z.uuid(),
  anchorDate:      CalendarDateSchema.optional(),
  force:           z.boolean().default(false),
});
export type ApplyTemplateInput = z.infer<typeof ApplyTemplateInputSchema>;

// ─── Personal note input ──────────────────────────────────────────────────────

/** Input schema for creating or updating a user's personal note on a calendar event. */
export const CalendarEventPersonalNoteInputSchema = z.object({
  eventId: z.uuid(),
  body: z.string().max(4000),
});
export type CalendarEventPersonalNoteInput = z.infer<typeof CalendarEventPersonalNoteInputSchema>;

// ─── Template inputs ──────────────────────────────────────────────────────────

/** Base fields for a single item within a milestone template. */
export const MilestoneTemplateItemBaseSchema = z.object({
  phaseId:              z.uuid().optional().nullable(),
  calendarDaysRelevance: z.enum(CALENDAR_DAYS_RELEVANCE).optional().nullable(),
  title:                z.string().min(1).max(200),
  description:          z.string().max(2000).optional(),
  offsetDays:           z.number().int(),
  durationDays:         z.number().int().min(1).default(1),
  allDay:               z.boolean().default(true),
  publishExternally:    z.boolean().default(true),
  visibilityFunctionIds: z.array(z.uuid()).min(1, 'Seleziona almeno una funzione'),
});

/** `offsetDays` is relative to the template's anchor date. */
export type MilestoneTemplateItemInput = z.infer<typeof MilestoneTemplateItemBaseSchema>;

/** Input schema for the header of a milestone template (name and optional description). */
export const MilestoneTemplateInputSchema = z.object({
  name: z.string().min(1).max(100),
  // `null` clears it on update; `undefined` leaves it as it is.
  description: z.string().max(500, 'Descrizione troppo lunga (max 500 caratteri)').nullable().optional(),
});
export type MilestoneTemplateInput = z.infer<typeof MilestoneTemplateInputSchema>;

// ─── Clone input ──────────────────────────────────────────────────────────────

/**
 * Input schema for cloning a season calendar from one brand/season to another.
 * The user picks which source planning groups to clone (matching groups are created/reused by name
 * in the target calendar); `dateShiftDays` is mandatory since there's no longer a single calendar-wide
 * anchorDate to auto-derive it from (anchorDate is now per planning group).
 */
export const CloneSeasonCalendarInputSchema = z.object({
  sourceBrandId: z.uuid(),
  sourceSeasonId: z.uuid(),
  targetBrandId: z.uuid(),
  targetSeasonId: z.uuid(),
  sourcePlanningGroupIds: z.array(z.uuid()).min(1),
  dateShiftDays: z.number().int(),
  /** When false (default), only active (non-cancelled) events are cloned. */
  includeCancelled: z.boolean().default(false),
});
export type CloneSeasonCalendarInput = z.infer<typeof CloneSeasonCalendarInputSchema>;

