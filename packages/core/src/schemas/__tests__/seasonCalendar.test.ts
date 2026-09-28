/**
 * Event instants are accepted only in the years the calendar-date helpers support (1900–9999): a
 * year typed as "26" in a date field used to be stored as year 26, and every deadline evaluation on
 * that event would then throw.
 */

import { describe, it, expect } from 'vitest';

import { ApplyTemplateInputSchema, CalendarEventBaseSchema, MilestoneRescheduleInputSchema } from '../seasonCalendar.js';

const ID = '00000000-0000-4000-8000-000000000000';

describe('event instants', () => {
  it.each(['1900-01-01T00:00:00.000Z', '2026-10-02T00:00:00.000Z', '9999-12-31T00:00:00.000Z'])('accept %s', value => {
    expect(MilestoneRescheduleInputSchema.safeParse({ id: ID, startAt: value, endAt: value, reason: 'motivo' }).success).toBe(true);
    expect(ApplyTemplateInputSchema.safeParse({ planningGroupId: ID, templateId: ID, anchorDate: value }).success).toBe(true);
  });

  it.each(['0026-10-02T00:00:00.000Z', '1899-12-31T23:59:59.999Z'])('refuse %s', value => {
    expect(MilestoneRescheduleInputSchema.safeParse({ id: ID, startAt: value, reason: 'motivo' }).success).toBe(false);
    expect(ApplyTemplateInputSchema.safeParse({ planningGroupId: ID, templateId: ID, anchorDate: value }).success).toBe(false);
    expect(CalendarEventBaseSchema.shape.startAt.safeParse(value).success).toBe(false);
    expect(CalendarEventBaseSchema.shape.endAt.safeParse(value).success).toBe(false);
  });
});
