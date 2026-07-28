/**
 * Zod schemas for the audit log viewer/export feature and the generic
 * "last modified by" lookup surfaced on individual entities.
 */

import { z } from 'zod';

/** Entity types that expose a "last modified by" lookup via `auditLog.getLastChange`. Restricting this to an explicit enum doubles as the authorization allowlist — an unmapped `targetType` is rejected at the input-parsing boundary before any permission check runs. */
export const AuditLogLastChangeTargetTypeSchema = z.enum([
  'CollectionLayoutRow',
  'PlanningGroup',
  'CalendarEvent',
  'PricingParameterSet',
]);

export const AuditLogGetLastChangeInputSchema = z.object({
  targetType: AuditLogLastChangeTargetTypeSchema,
  targetId: z.string().uuid(),
});

export const AuditLogResultSchema = z.enum(['SUCCESS', 'FAILURE']);

/** Shared filter fields between `auditLog.list` (paginated) and `auditLog.getExportLink` (same filters, unpaginated CSV). */
export const AuditLogFiltersSchema = z.object({
  actorId: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
  targetType: z.string().max(100).optional(),
  result: AuditLogResultSchema.optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
});

export const AuditLogListInputSchema = AuditLogFiltersSchema.extend({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(50),
});

export type AuditLogLastChangeTargetType = z.infer<typeof AuditLogLastChangeTargetTypeSchema>;
export type AuditLogGetLastChangeInput = z.infer<typeof AuditLogGetLastChangeInputSchema>;
export type AuditLogResult = z.infer<typeof AuditLogResultSchema>;
export type AuditLogFilters = z.infer<typeof AuditLogFiltersSchema>;
export type AuditLogListInput = z.infer<typeof AuditLogListInputSchema>;
