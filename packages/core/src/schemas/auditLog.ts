/**
 * Zod schemas for the audit log viewer/export feature and the generic
 * "last modified by" lookup surfaced on individual entities.
 */

import { z } from 'zod';

import { CalendarDateSchema } from '../utils/zod.js';

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

/**
 * Shared filter fields between `auditLog.list` (paginated) and `auditLog.getExportLink` (same filters, unpaginated export).
 * The dates are calendar days as picked, both included: the server reads them in the caller's time zone.
 */
export const AuditLogFiltersSchema = z.object({
  actorId: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
  targetType: z.string().max(100).optional(),
  result: AuditLogResultSchema.optional(),
  dateFrom: CalendarDateSchema.optional(),
  dateTo: CalendarDateSchema.optional(),
});

/** Formats the audit log export route serves, chosen by its `format` query parameter. */
export const AuditLogExportFormatSchema = z.enum(['csv', 'xlsx']);

export const AuditLogListInputSchema = AuditLogFiltersSchema.extend({
  page: z.number().int().min(1).default(1),
  limit: z.number().int().min(1).max(100).default(50),
});

export type AuditLogLastChangeTargetType = z.infer<typeof AuditLogLastChangeTargetTypeSchema>;
export type AuditLogGetLastChangeInput = z.infer<typeof AuditLogGetLastChangeInputSchema>;
export type AuditLogResult = z.infer<typeof AuditLogResultSchema>;
export type AuditLogFilters = z.infer<typeof AuditLogFiltersSchema>;
export type AuditLogExportFormat = z.infer<typeof AuditLogExportFormatSchema>;
export type AuditLogListInput = z.infer<typeof AuditLogListInputSchema>;
