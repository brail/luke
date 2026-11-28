import { describe, it, expect } from 'vitest';

import { MaintenanceModeScheduleInputSchema } from '../maintenanceMode.js';

/**
 * A scheduled maintenance is an instant typed by hand: the timed range (ADR-035 §Bounds). Whether it
 * is in the future is `schedule`'s check, not the schema's (#248).
 */
describe('MaintenanceModeScheduleInputSchema.scheduledAt', () => {
  const schedule = (scheduledAt: string) => MaintenanceModeScheduleInputSchema.safeParse({ scheduledAt });

  it.each(['2999-01-01T09:00:00.000Z', '2001-01-01T09:00:00.000Z'])('accepts %s', value => {
    expect(schedule(value).success).toBe(true);
  });

  it.each(['2999-01-01', '9999-12-30T12:00:00.000Z'])('refuses %s', value => {
    expect(schedule(value).success).toBe(false);
  });
});
