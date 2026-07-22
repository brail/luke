/**
 * Zod schemas for standalone Maintenance Mode: INACTIVE -> SCHEDULED -> ACTIVE -> INACTIVE.
 */

import { z } from 'zod';

export const MaintenanceModeStatusSchema = z.enum(['INACTIVE', 'SCHEDULED', 'ACTIVE']);

/** Default warning thresholds (minutes before activation) when the admin doesn't override them. */
export const DEFAULT_WARNING_LEAD_MINUTES = [15, 5, 1];

export const MaintenanceModeScheduleInputSchema = z
  .object({
    scheduledAt: z.string().datetime(),
    message: z.string().max(500).trim().optional(),
    forceLogout: z.boolean().default(false),
    warningLeadMinutes: z.array(z.number().int().positive()).max(10).default(DEFAULT_WARNING_LEAD_MINUTES),
    notifyByEmail: z.boolean().default(false),
  })
  .refine(data => new Date(data.scheduledAt).getTime() > Date.now(), {
    message: 'La data pianificata deve essere nel futuro',
    path: ['scheduledAt'],
  });

export const MaintenanceModeActivateInputSchema = z.object({
  message: z.string().max(500).trim().optional(),
  forceLogout: z.boolean().default(false),
});

/** Full maintenance-mode state as returned by `getStatus` — deliberately public (pre-login banner). */
export const MaintenanceModeStateSchema = z.object({
  status: MaintenanceModeStatusSchema,
  scheduledAt: z.string().nullable(),
  activatedAt: z.string().nullable(),
  message: z.string().nullable(),
  forceLogout: z.boolean(),
  warningLeadMinutes: z.array(z.number()),
  warningsSent: z.array(z.number()),
  activatedByUserId: z.string().nullable(),
  notifyByEmail: z.boolean(),
});

export type MaintenanceModeStatus = z.infer<typeof MaintenanceModeStatusSchema>;
export type MaintenanceModeScheduleInput = z.infer<typeof MaintenanceModeScheduleInputSchema>;
export type MaintenanceModeActivateInput = z.infer<typeof MaintenanceModeActivateInputSchema>;
export type MaintenanceModeState = z.infer<typeof MaintenanceModeStateSchema>;

export type MaintenanceUrgencyTier = 'far' | 'normal' | 'approaching' | 'imminent';

/**
 * Minute breakpoints between maintenance-mode "urgency" tiers — single source of truth shared
 * by the backend scheduler (picks its tick cadence from the tier) and the frontend banner
 * (picks its visual prominence from the same tier), so a countdown's perceived urgency and its
 * actual precision always agree.
 */
export function getMaintenanceUrgencyTier(minutesRemaining: number): MaintenanceUrgencyTier {
  if (minutesRemaining >= 24 * 60) return 'far';
  if (minutesRemaining >= 60) return 'normal';
  if (minutesRemaining >= 15) return 'approaching';
  return 'imminent';
}
