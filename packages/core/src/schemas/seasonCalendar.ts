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

/** Entity types that can serve as anchors for calendar events (linking events to domain objects). */
export const ANCHOR_ENTITY_TYPE = [
  'COLLECTION_LAYOUT',
  'COLLECTION_LAYOUT_ROW',
] as const;
export type AnchorEntityType = (typeof ANCHOR_ENTITY_TYPE)[number];

/** Input schema for a state effect to be triggered by a calendar event (e.g. lock a collection layout). */
export const CalendarEventStateEffectInputSchema = z.object({
  effectType:           z.enum(STATE_EFFECT_TYPE),
  targetEntityType:     z.literal('COLLECTION_LAYOUT'),
  targetEntityId:       z.string().uuid(),
  requiresConfirmation: z.boolean(),
});
export type CalendarEventStateEffectInput = z.infer<typeof CalendarEventStateEffectInputSchema>;

/** Input schema for anchoring a calendar event to a domain entity (collection layout or row). */
export const CalendarEventAnchorInputSchema = z.object({
  entityType: z.enum(ANCHOR_ENTITY_TYPE),
  entityId:   z.string().uuid(),
});
export type CalendarEventAnchorInput = z.infer<typeof CalendarEventAnchorInputSchema>;

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

/** Lifecycle statuses for an individual calendar event. */
export const CALENDAR_EVENT_STATUS = [
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUS)[number];

/** Lifecycle statuses for a season calendar. `ARCHIVED` calendars are read-only. */
export const SEASON_CALENDAR_STATUS = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type SeasonCalendarStatus = (typeof SEASON_CALENDAR_STATUS)[number];

// ─── CalendarCatalogItem ──────────────────────────────────────────────────────

/** Full calendar catalog item as returned by the API (event type, section label, ordering). */
export const CalendarCatalogItemSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  value: z.string(),
  label: z.string(),
  order: z.number().int(),
  isActive: z.boolean(),
});
export type CalendarCatalogItem = z.infer<typeof CalendarCatalogItemSchema>;

/** Input schema for creating a new calendar catalog item (admin-only). */
export const CalendarCatalogItemCreateSchema = z.object({
  type: z.string().min(1),
  value: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  order: z.number().int().default(0),
});
export type CalendarCatalogItemCreate = z.infer<typeof CalendarCatalogItemCreateSchema>;

/** Input schema for updating an existing calendar catalog item (label and order only). */
export const CalendarCatalogItemUpdateSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(100),
  order: z.number().int().optional(),
});
export type CalendarCatalogItemUpdate = z.infer<typeof CalendarCatalogItemUpdateSchema>;

// ─── CalendarEvent input ──────────────────────────────────────────────────────

/** Base fields shared by calendar event create and update inputs, before cross-field refinements. */
export const CalendarEventBaseSchema = z.object({
  calendarId:                   z.string().uuid(),
  ownerFunctionId:              z.string().uuid(),
  type:                         z.string().min(1),
  title:                        z.string().min(1).max(200),
  startAt:                      z.string().datetime(),
  description:                  z.string().max(2000).optional(),
  endAt:                        z.string().datetime().optional(),
  allDay:                       z.boolean().default(false),
  publishExternally:            z.boolean().default(true),
  templateItemId:               z.string().uuid().optional(),
  status:                       z.enum(CALENDAR_EVENT_STATUS).default('PLANNED'),
  visibilityFunctionIds:        z.array(z.string().uuid()).min(1),
});

/**
 * Full input schema for creating a calendar event.
 * Enforces that `visibilityFunctionIds` includes the `ownerFunctionId`.
 */
export const CalendarEventInputSchema = CalendarEventBaseSchema.refine(
  data => data.visibilityFunctionIds.includes(data.ownerFunctionId),
  {
    message: 'visibilityFunctionIds must include ownerFunctionId',
    path: ['visibilityFunctionIds'],
  }
);

export type CalendarEventInput = z.infer<typeof CalendarEventInputSchema>;

// ─── Personal note input ──────────────────────────────────────────────────────

/** Input schema for creating or updating a user's personal note on a calendar event. */
export const CalendarEventPersonalNoteInputSchema = z.object({
  eventId: z.string().uuid(),
  body: z.string().max(4000),
});
export type CalendarEventPersonalNoteInput = z.infer<typeof CalendarEventPersonalNoteInputSchema>;

// ─── Template inputs ──────────────────────────────────────────────────────────

/**
 * Input schema for a single item within a milestone template.
 * `offsetDays` is relative to the template's anchor date; visibility must include the owner function.
 */
export const MilestoneTemplateItemInputSchema = z
  .object({
    ownerFunctionId:      z.string().uuid(),
    type:                 z.string().min(1),
    title:                z.string().min(1).max(200),
    description:          z.string().max(2000).optional(),
    offsetDays:           z.number().int(),
    durationDays:         z.number().int().min(0).default(0),
    publishExternally:    z.boolean().default(true),
    visibilityFunctionIds: z.array(z.string().uuid()).min(1),
  })
  .refine(
    data => data.visibilityFunctionIds.includes(data.ownerFunctionId),
    { message: 'visibilityFunctionIds must include ownerFunctionId', path: ['visibilityFunctionIds'] }
  );

export type MilestoneTemplateItemInput = z.infer<typeof MilestoneTemplateItemInputSchema>;

/** Input schema for the header of a milestone template (name and optional description). */
export const MilestoneTemplateInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});
export type MilestoneTemplateInput = z.infer<typeof MilestoneTemplateInputSchema>;

// ─── Clone input ──────────────────────────────────────────────────────────────

/** Input schema for cloning a season calendar from one brand/season to another, with optional date shift. */
export const CloneSeasonCalendarInputSchema = z.object({
  sourceBrandId: z.string().uuid(),
  sourceSeasonId: z.string().uuid(),
  targetBrandId: z.string().uuid(),
  targetSeasonId: z.string().uuid(),
  dateShiftDays: z.number().int().optional(),
  includeStatuses: z
    .array(z.enum(CALENDAR_EVENT_STATUS))
    .default(['PLANNED', 'IN_PROGRESS']),
});
export type CloneSeasonCalendarInput = z.infer<typeof CloneSeasonCalendarInputSchema>;

