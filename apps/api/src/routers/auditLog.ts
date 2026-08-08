/**
 * tRPC router for browsing the audit trail: generic "last change" lookup for a
 * single entity (widget on collection layout row, planning group, calendar event,
 * pricing parameter set) and the full admin browse/export page.
 */

import {
  AuditLogFiltersSchema,
  AuditLogGetLastChangeInputSchema,
  AuditLogListInputSchema,
  type AuditLogGetLastChangeInput,
  type AuditLogLastChangeTargetType,
  type Permission,
} from '@luke/core';

import { auditActorName, buildAuditLogWhere } from '../lib/auditLog';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';
import { signAuditLogExportToken } from '../utils/downloadToken';

/**
 * Permission required to read the "last change" of each supported entity —
 * mirrors the read permission of the entity itself, so the widget never exposes
 * more than the user already sees when opening the entity.
 */
const LAST_CHANGE_TARGET_PERMISSIONS: Record<AuditLogLastChangeTargetType, Permission> = {
  CollectionLayoutRow: 'collection_layout:read',
  PlanningGroup: 'season_calendar:read',
  CalendarEvent: 'season_calendar:read',
  PricingParameterSet: 'pricing:read',
};

/**
 * Explicit output shape for `list` — without it, the client-side tRPC type is inferred through
 * Prisma's `findMany`/`include` generics and TypeScript hits "Type instantiation is excessively
 * deep" in consumers (the audit log page). A concrete interface keeps the wire type shallow.
 */
export interface AuditLogEntryDTO {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  result: string;
  /** `unknown`, not Prisma's `JsonValue` — this DTO crosses the wire to apps/web, which has no business depending on a Prisma-shaped recursive type (and doing so previously caused "Type instantiation is excessively deep" in the audit log page). */
  metadata: unknown;
  ip: string | null;
  createdAt: Date;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
}

export interface AuditLogListOutput {
  items: AuditLogEntryDTO[];
  total: number;
  page: number;
  limit: number;
}

export const auditLogRouter = router({
  /**
   * Latest audit event (any action, not just UPDATE) for a single entity —
   * feeds the "last change" widget on detail views.
   *
   * @auth {read permission of the target entity, see LAST_CHANGE_TARGET_PERMISSIONS}
   * @input {AuditLogGetLastChangeInputSchema} — targetType and targetId of the entity to look up.
   * @output {{ action: string, createdAt: Date, actorName: string | null } | null} — most recent
   *   successful audit event for the target, or null if none exists.
   */
  getLastChange: protectedProcedure
    .input(AuditLogGetLastChangeInputSchema)
    .use(requirePermission<AuditLogGetLastChangeInput>(input => LAST_CHANGE_TARGET_PERMISSIONS[input.targetType]))
    .query(async ({ ctx, input }) => {
      const entry = await ctx.prisma.auditLog.findFirst({
        where: { targetType: input.targetType, targetId: input.targetId, result: 'SUCCESS' },
        orderBy: { createdAt: 'desc' },
        select: {
          action: true,
          createdAt: true,
          actor: { select: { firstName: true, lastName: true, username: true } },
        },
      });
      if (!entry) return null;

      return {
        action: entry.action,
        createdAt: entry.createdAt,
        actorName: auditActorName(entry.actor),
      };
    }),

  /**
   * Paginated list of the full audit trail, filterable by actor/action/entity/result/date.
   *
   * @auth {audit:read_all}
   * @input {AuditLogListInputSchema} — filters (actor, action, targetType, result, date range)
   *   plus page/limit.
   * @output {AuditLogListOutput} — paginated audit log entries with resolved actor name/email.
   */
  list: protectedProcedure
    .use(requirePermission('audit:read_all'))
    .input(AuditLogListInputSchema)
    .query(async ({ ctx, input }): Promise<AuditLogListOutput> => {
      const where = buildAuditLogWhere(input);

      const [items, total] = await Promise.all([
        ctx.prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (input.page - 1) * input.limit,
          take: input.limit,
          include: { actor: { select: { firstName: true, lastName: true, username: true, email: true } } },
        }),
        ctx.prisma.auditLog.count({ where }),
      ]);

      return {
        items: items.map(entry => ({
          id: entry.id,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          result: entry.result,
          metadata: entry.metadata,
          ip: entry.ip,
          createdAt: entry.createdAt,
          actorId: entry.actorId,
          actorName: auditActorName(entry.actor),
          actorEmail: entry.actor?.email ?? null,
        })),
        total,
        page: input.page,
        limit: input.limit,
      };
    }),

  /**
   * Signs a short-lived (5-minute) token to download the CSV export of the audit trail,
   * filtered the same way as `list` — the raw `/maintenance/audit-log/export` route verifies
   * it and streams the CSV.
   *
   * @auth {audit:read_all}
   * @input {AuditLogFiltersSchema} — same filters accepted by `list`.
   * @output {{ token: string }} — signed short-lived download token for the CSV export route.
   */
  getExportLink: protectedProcedure
    .use(requirePermission('audit:read_all'))
    .input(AuditLogFiltersSchema)
    .mutation(({ input }) => {
      const token = signAuditLogExportToken({ filters: input });
      return { token };
    }),
});
