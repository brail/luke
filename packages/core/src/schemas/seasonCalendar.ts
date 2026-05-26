import { z } from 'zod';

// ─── Const arrays ─────────────────────────────────────────────────────────────

export const CALENDAR_EVENT_STATUS = [
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type CalendarEventStatus = (typeof CALENDAR_EVENT_STATUS)[number];

export const SEASON_CALENDAR_STATUS = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type SeasonCalendarStatus = (typeof SEASON_CALENDAR_STATUS)[number];

// ─── CalendarCatalogItem ──────────────────────────────────────────────────────

export const CalendarCatalogItemSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  value: z.string(),
  label: z.string(),
  order: z.number().int(),
  isActive: z.boolean(),
});
export type CalendarCatalogItem = z.infer<typeof CalendarCatalogItemSchema>;

export const CalendarCatalogItemCreateSchema = z.object({
  type: z.string().min(1),
  value: z.string().min(1).max(50),
  label: z.string().min(1).max(100),
  order: z.number().int().default(0),
});
export type CalendarCatalogItemCreate = z.infer<typeof CalendarCatalogItemCreateSchema>;

export const CalendarCatalogItemUpdateSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(100),
  order: z.number().int().optional(),
});
export type CalendarCatalogItemUpdate = z.infer<typeof CalendarCatalogItemUpdateSchema>;

// ─── CalendarEvent input ──────────────────────────────────────────────────────

export const CalendarEventBaseSchema = z.object({
  calendarId: z.string().uuid(),
  ownerFunctionId: z.string().uuid(),
  type: z.string().min(1),
  title: z.string().min(1).max(200),
  startAt: z.string().datetime(),
  description: z.string().max(2000).optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().default(false),
  publishExternally: z.boolean().default(true),
  templateItemId: z.string().uuid().optional(),
  status: z.enum(CALENDAR_EVENT_STATUS).default('PLANNED'),
  visibilityFunctionIds: z.array(z.string().uuid()).min(1),
});

export const CalendarEventInputSchema = CalendarEventBaseSchema.refine(
  data => data.visibilityFunctionIds.includes(data.ownerFunctionId),
  {
    message: 'visibilityFunctionIds must include ownerFunctionId',
    path: ['visibilityFunctionIds'],
  }
);

export type CalendarEventInput = z.infer<typeof CalendarEventInputSchema>;

// ─── Personal note input ──────────────────────────────────────────────────────

export const CalendarEventPersonalNoteInputSchema = z.object({
  eventId: z.string().uuid(),
  body: z.string().max(4000),
});
export type CalendarEventPersonalNoteInput = z.infer<typeof CalendarEventPersonalNoteInputSchema>;

// ─── Template inputs ──────────────────────────────────────────────────────────

export const MilestoneTemplateItemInputSchema = z
  .object({
    ownerFunctionId: z.string().uuid(),
    type: z.string().min(1),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    offsetDays: z.number().int(),
    durationDays: z.number().int().min(0).default(0),
    publishExternally: z.boolean().default(true),
    visibilityFunctionIds: z.array(z.string().uuid()).min(1),
  })
  .refine(
    data => data.visibilityFunctionIds.includes(data.ownerFunctionId),
    { message: 'visibilityFunctionIds must include ownerFunctionId', path: ['visibilityFunctionIds'] }
  );

export type MilestoneTemplateItemInput = z.infer<typeof MilestoneTemplateItemInputSchema>;

export const MilestoneTemplateInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});
export type MilestoneTemplateInput = z.infer<typeof MilestoneTemplateInputSchema>;

// ─── Clone input ──────────────────────────────────────────────────────────────

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
