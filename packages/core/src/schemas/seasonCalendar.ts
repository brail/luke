import { z } from 'zod';

// ─── State effect / anchor types ──────────────────────────────────────────────

/**
 * Allowed state-effect types triggered when a calendar milestone is completed.
 * Used to automatically lock or unlock a collection layout.
 */
export const STATE_EFFECT_TYPE = [
  'LOCK_COLLECTION_LAYOUT',
  'UNLOCK_COLLECTION_LAYOUT',
] as const;
export type StateEffectType = (typeof STATE_EFFECT_TYPE)[number];

/** Input schema for a state effect to be triggered by a calendar event (e.g. lock a collection layout). */
export const CalendarEventStateEffectInputSchema = z.object({
  effectType:           z.enum(STATE_EFFECT_TYPE),
  targetEntityType:     z.literal('COLLECTION_LAYOUT'),
  targetEntityId:       z.string().uuid(),
  requiresConfirmation: z.boolean(),
});
export type CalendarEventStateEffectInput = z.infer<typeof CalendarEventStateEffectInputSchema>;

/** Input schema for a vendor closure or open-day period within a season, used in working-day calculations. */
export const VendorClosurePeriodInputSchema = z.object({
  vendorId:        z.string().uuid(),
  seasonId:        z.string().uuid(),
  name:            z.string().min(1).max(200),
  startDate:       z.string().date(),
  endDate:         z.string().date(),
  type:            z.enum(['CLOSURE', 'OPEN']).default('CLOSURE'),
  sourceHolidayId: z.string().uuid().optional(),
  notes:           z.string().max(500).optional(),
});
export type VendorClosurePeriodInput = z.infer<typeof VendorClosurePeriodInputSchema>;

// ─── Const arrays ─────────────────────────────────────────────────────────────

/** Lifecycle statuses for a season calendar. `ARCHIVED` calendars are read-only. */
export const SEASON_CALENDAR_STATUS = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type SeasonCalendarStatus = (typeof SEASON_CALENDAR_STATUS)[number];

/**
 * Which holiday calendar(s) count toward an event's working-days deadline countdown. Unset means
 * the countdown stays in plain calendar days (default, opt-in only). See
 * docs/TASK_working_days_calendar_relevance.md for the full design and resolution rules.
 */
export const CALENDAR_DAYS_RELEVANCE = ['COMPANY', 'VENDOR', 'BOTH'] as const;
export type CalendarDaysRelevance = (typeof CALENDAR_DAYS_RELEVANCE)[number];

// ─── CalendarEvent input ──────────────────────────────────────────────────────

/** Base fields shared by calendar event create and update inputs. */
export const CalendarEventBaseSchema = z.object({
  planningGroupId:              z.string().uuid(),
  phaseId:                      z.string().uuid().optional().nullable(),
  calendarDaysRelevance:        z.enum(CALENDAR_DAYS_RELEVANCE).optional().nullable(),
  title:                        z.string().min(1).max(200),
  startAt:                      z.string().datetime(),
  description:                  z.string().max(2000).optional(),
  endAt:                        z.string().datetime().optional(),
  allDay:                       z.boolean().default(false),
  publishExternally:            z.boolean().default(true),
  templateItemId:               z.string().uuid().optional(),
  visibilityFunctionIds:        z.array(z.string().uuid()).min(1),
});

export type CalendarEventInput = z.infer<typeof CalendarEventBaseSchema>;

// ─── Planning group input ─────────────────────────────────────────────────────

/** Input schema for creating or renaming a PlanningGroup within a SeasonCalendar. */
export const PlanningGroupInputSchema = z.object({
  name: z.string().min(1).max(100),
});
export type PlanningGroupInput = z.infer<typeof PlanningGroupInputSchema>;

/** Input schema for applying a milestone template to a planning group. `calendarId` is derived
 * server-side from `planningGroupId` — never accepted directly, to avoid a mismatched pair. */
export const ApplyTemplateInputSchema = z.object({
  planningGroupId: z.string().uuid(),
  templateId:      z.string().uuid(),
  anchorDate:      z.string().datetime().optional(),
  force:           z.boolean().default(false),
});
export type ApplyTemplateInput = z.infer<typeof ApplyTemplateInputSchema>;

// ─── Personal note input ──────────────────────────────────────────────────────

/** Input schema for creating or updating a user's personal note on a calendar event. */
export const CalendarEventPersonalNoteInputSchema = z.object({
  eventId: z.string().uuid(),
  body: z.string().max(4000),
});
export type CalendarEventPersonalNoteInput = z.infer<typeof CalendarEventPersonalNoteInputSchema>;

// ─── Template inputs ──────────────────────────────────────────────────────────

/** Base fields for a single item within a milestone template. */
export const MilestoneTemplateItemBaseSchema = z.object({
  phaseId:              z.string().uuid().optional().nullable(),
  calendarDaysRelevance: z.enum(CALENDAR_DAYS_RELEVANCE).optional().nullable(),
  title:                z.string().min(1).max(200),
  description:          z.string().max(2000).optional(),
  offsetDays:           z.number().int(),
  durationDays:         z.number().int().min(0).default(0),
  allDay:               z.boolean().default(true),
  publishExternally:    z.boolean().default(true),
  visibilityFunctionIds: z.array(z.string().uuid()).min(1),
});

/** `offsetDays` is relative to the template's anchor date. */
export type MilestoneTemplateItemInput = z.infer<typeof MilestoneTemplateItemBaseSchema>;

/** Input schema for the header of a milestone template (name and optional description). */
export const MilestoneTemplateInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
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
  sourceBrandId: z.string().uuid(),
  sourceSeasonId: z.string().uuid(),
  targetBrandId: z.string().uuid(),
  targetSeasonId: z.string().uuid(),
  sourcePlanningGroupIds: z.array(z.string().uuid()).min(1),
  dateShiftDays: z.number().int(),
  /** When false (default), only active (non-cancelled) events are cloned. */
  includeCancelled: z.boolean().default(false),
});
export type CloneSeasonCalendarInput = z.infer<typeof CloneSeasonCalendarInputSchema>;

