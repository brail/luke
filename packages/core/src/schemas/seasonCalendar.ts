import { z } from 'zod';

// ─── Const arrays (follow collectionLayout.ts pattern) ───────────────────────

export const CALENDAR_MILESTONE_TYPE = [
  'KICKOFF',
  'REVIEW',
  'GATE',
  'DEADLINE',
  'MILESTONE',
  'CUSTOM',
] as const;
export type CalendarMilestoneType = (typeof CALENDAR_MILESTONE_TYPE)[number];

export const CALENDAR_MILESTONE_STATUS = [
  'PLANNED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;
export type CalendarMilestoneStatus = (typeof CALENDAR_MILESTONE_STATUS)[number];

export const SEASON_CALENDAR_STATUS = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type SeasonCalendarStatus = (typeof SEASON_CALENDAR_STATUS)[number];

// ─── Planning section keys (used as milestone visibility + owner keys) ────────

export const PLANNING_SECTION_KEYS = [
  'planning.sales',
  'planning.product',
  'planning.sourcing',
  'planning.merchandising',
] as const;
export type PlanningSectionKey = (typeof PLANNING_SECTION_KEYS)[number];

const planningSectionKeyEnum = z.enum(PLANNING_SECTION_KEYS);

// ─── Milestone input ──────────────────────────────────────────────────────────

export const CalendarMilestoneBaseSchema = z.object({
  calendarId: z.string().uuid(),
  ownerSectionKey: planningSectionKeyEnum,
  type: z.enum(CALENDAR_MILESTONE_TYPE),
  title: z.string().min(1).max(200),
  startAt: z.string().datetime(),
  description: z.string().max(2000).optional(),
  endAt: z.string().datetime().optional(),
  allDay: z.boolean().default(false),
  publishExternally: z.boolean().default(true),
  templateItemId: z.string().uuid().optional(),
  status: z.enum(CALENDAR_MILESTONE_STATUS).default('PLANNED'),
  visibleSectionKeys: z.array(planningSectionKeyEnum).min(1),
});

export const CalendarMilestoneInputSchema = CalendarMilestoneBaseSchema.refine(
  data => data.visibleSectionKeys.includes(data.ownerSectionKey),
  {
    message: 'visibleSectionKeys must include ownerSectionKey',
    path: ['visibleSectionKeys'],
  }
);

export type CalendarMilestoneInput = z.infer<typeof CalendarMilestoneInputSchema>;

// ─── Personal note input ──────────────────────────────────────────────────────

export const MilestonePersonalNoteInputSchema = z.object({
  milestoneId: z.string().uuid(),
  body: z.string().min(1).max(4000),
});
export type MilestonePersonalNoteInput = z.infer<typeof MilestonePersonalNoteInputSchema>;

// ─── Template inputs ──────────────────────────────────────────────────────────

export const MilestoneTemplateItemInputSchema = z
  .object({
    ownerSectionKey: planningSectionKeyEnum,
    type: z.enum(CALENDAR_MILESTONE_TYPE),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    offsetDays: z.number().int(),
    durationDays: z.number().int().min(0).default(0),
    publishExternally: z.boolean().default(true),
    visibleSectionKeys: z.array(planningSectionKeyEnum).min(1),
  })
  .refine(
    data => data.visibleSectionKeys.includes(data.ownerSectionKey),
    { message: 'visibleSectionKeys must include ownerSectionKey', path: ['visibleSectionKeys'] }
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
    .array(z.enum(CALENDAR_MILESTONE_STATUS))
    .default(['PLANNED', 'IN_PROGRESS']),
});
export type CloneSeasonCalendarInput = z.infer<typeof CloneSeasonCalendarInputSchema>;
