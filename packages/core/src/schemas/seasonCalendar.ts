import { z } from 'zod';

// ─── What-If Engine v2 types ──────────────────────────────────────────────────

export const DEPENDENCY_SEVERITY = ['HARD', 'SOFT'] as const;
export type DependencySeverity = (typeof DEPENDENCY_SEVERITY)[number];

export const EVENT_SEVERITY = ['CRITICAL', 'NORMAL', 'INFO'] as const;
export type EventSeverity = (typeof EVENT_SEVERITY)[number];

export const RELEVANT_COUNTRY_CODES = ['IT', 'CN', 'VN', 'IN', 'TR'] as const;
export type RelevantCountryCode = (typeof RELEVANT_COUNTRY_CODES)[number];

export const STATE_EFFECT_TYPE = [
  'LOCK_COLLECTION_LAYOUT',
  'UNLOCK_COLLECTION_LAYOUT',
] as const;
export type StateEffectType = (typeof STATE_EFFECT_TYPE)[number];

export const ANCHOR_ENTITY_TYPE = [
  'COLLECTION_LAYOUT',
  'COLLECTION_LAYOUT_ROW',
] as const;
export type AnchorEntityType = (typeof ANCHOR_ENTITY_TYPE)[number];

export const CalendarEventDependencyInputSchema = z
  .object({
    predecessorId: z.string().uuid(),
    successorId:   z.string().uuid(),
    minGapDays:    z.number().int().min(0).optional(),
    maxGapDays:    z.number().int().min(0).optional(),
    severity:      z.enum(DEPENDENCY_SEVERITY),
    reason:        z.string().max(500).optional(),
  })
  .refine(d => d.predecessorId !== d.successorId, {
    message: 'predecessorId e successorId devono essere distinti',
  })
  .refine(
    d => {
      if (d.minGapDays !== undefined && d.maxGapDays !== undefined) {
        return d.maxGapDays >= d.minGapDays;
      }
      return true;
    },
    { message: 'maxGapDays deve essere >= minGapDays' },
  );
export type CalendarEventDependencyInput = z.infer<typeof CalendarEventDependencyInputSchema>;

export const UpdateDependencyGapsInputSchema = z.object({
  id:         z.string().uuid(),
  minGapDays: z.number().int().min(0).optional(),
  maxGapDays: z.number().int().min(0).optional(),
});
export type UpdateDependencyGapsInput = z.infer<typeof UpdateDependencyGapsInputSchema>;

export const TemplateDependencyInputSchema = CalendarEventDependencyInputSchema;
export type TemplateDependencyInput = CalendarEventDependencyInput;

export const CalendarEventStateEffectInputSchema = z.object({
  effectType:           z.enum(STATE_EFFECT_TYPE),
  targetEntityType:     z.literal('COLLECTION_LAYOUT'),
  targetEntityId:       z.string().uuid(),
  requiresConfirmation: z.boolean(),
});
export type CalendarEventStateEffectInput = z.infer<typeof CalendarEventStateEffectInputSchema>;

export const CalendarEventAnchorInputSchema = z.object({
  entityType: z.enum(ANCHOR_ENTITY_TYPE),
  entityId:   z.string().uuid(),
});
export type CalendarEventAnchorInput = z.infer<typeof CalendarEventAnchorInputSchema>;

export const WhatIfRequestSchema = z.object({
  calendarIds:       z.array(z.string().uuid()).min(1),
  proposedShifts:    z.array(
    z.object({
      eventId:    z.string().uuid(),
      newStartAt: z.string().datetime(),
    }),
  ),
  requestSuggestion: z.boolean().default(false),
});
export type WhatIfRequest = z.infer<typeof WhatIfRequestSchema>;

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
  severity:                     z.enum(EVENT_SEVERITY).default('NORMAL'),
  relevantCountries:            z.array(z.enum(RELEVANT_COUNTRY_CODES)).default([]),
  requiredCollectionProgress:   z.string().min(1).nullish(),
  progressWarningDays:          z.number().int().min(1).max(365).nullish(),
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
    ownerFunctionId:      z.string().uuid(),
    type:                 z.string().min(1),
    title:                z.string().min(1).max(200),
    description:          z.string().max(2000).optional(),
    offsetDays:           z.number().int(),
    durationDays:         z.number().int().min(0).default(0),
    publishExternally:    z.boolean().default(true),
    visibilityFunctionIds: z.array(z.string().uuid()).min(1),
    severity:             z.enum(EVENT_SEVERITY).default('NORMAL'),
    relevantCountries:    z.array(z.enum(RELEVANT_COUNTRY_CODES)).default([]),
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

