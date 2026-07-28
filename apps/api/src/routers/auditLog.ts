/**
 * Router tRPC per la consultazione dell'audit trail: lookup generico "ultima modifica"
 * per singola entità (widget su collection layout row, planning group, calendar event,
 * pricing parameter set) e la pagina admin di consultazione/export completa.
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
 * Permission richiesta per leggere "ultima modifica" di ciascuna entità supportata —
 * rispecchia il permesso di lettura dell'entità stessa, così il widget non espone mai
 * più di quanto l'utente veda già aprendo l'entità.
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
   * Ultimo evento audit (qualsiasi azione, non solo UPDATE) per una singola entità —
   * alimenta il widget "ultima modifica" sulle viste di dettaglio.
   *
   * @auth {permesso di lettura dell'entità target, vedi LAST_CHANGE_TARGET_PERMISSIONS}
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
   * Elenco paginato dell'audit trail completo, filtrabile per autore/azione/entità/esito/data.
   *
   * @auth {audit:read_all}
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
   * Firma un token temporaneo (5 minuti) per scaricare l'export CSV dell'audit trail filtrato
   * come `list` — la route raw `/maintenance/audit-log/export` lo verifica e streamma il CSV.
   *
   * @auth {audit:read_all}
   */
  getExportLink: protectedProcedure
    .use(requirePermission('audit:read_all'))
    .input(AuditLogFiltersSchema)
    .mutation(({ input }) => {
      const token = signAuditLogExportToken({ filters: input });
      return { token };
    }),
});
