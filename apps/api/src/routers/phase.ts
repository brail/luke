/**
 * Router tRPC per il catalogo Phase unificato.
 * Sostituisce i due domini paralleli CollectionCatalogItem(type=progress) e
 * CalendarCatalogItem(type=eventType) con un unico ordinamento comparabile,
 * usato sia dallo stato di produzione delle righe collezione sia dal calendario.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { PhaseInputSchema, PhaseInputBaseSchema, partialWithoutDefaults } from '@luke/core';


import { logAudit } from '../lib/auditLog';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';

/** Derives the display code from position: order 0 → "01", order 1 → "02", ... */
function codeForOrder(order: number): string {
  return String(order + 1).padStart(2, '0');
}

export const phaseRouter = router({
  /**
   * Lists active phases, used to populate frontend selects.
   *
   * @auth {phase_catalog:read}
   * @output {Phase[]} — active phases sorted by order.
   */
  list: protectedProcedure
    .use(requirePermission('phase_catalog:read'))
    .query(async ({ ctx }) => {
      return ctx.prisma.phase.findMany({
        where: { isActive: true },
        orderBy: { order: 'asc' },
      });
    }),

  /**
   * Lists all phases including inactive ones, for admin management.
   *
   * @auth {phase_catalog:update}
   * @output {Phase[]} — all phases sorted by order.
   */
  listAll: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .query(async ({ ctx }) => {
      return ctx.prisma.phase.findMany({
        orderBy: { order: 'asc' },
      });
    }),

  /**
   * Creates a new phase.
   *
   * @auth {phase_catalog:update}
   * @input {PhaseInputSchema} — value (unique), label, optional order. `code` is derived from order, not client-settable.
   * @output {Phase} — the newly created phase.
   */
  create: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(PhaseInputSchema)
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.prisma.phase.findUnique({
        where: { value: input.value },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Il valore '${input.value}' esiste già`,
        });
      }

      const maxOrder = await ctx.prisma.phase.aggregate({
        _max: { order: true },
      });
      const order = input.order ?? (maxOrder._max.order ?? -1) + 1;

      const result = await ctx.prisma.phase.create({
        data: {
          value: input.value,
          label: input.label,
          code: codeForOrder(order),
          order,
        },
      });

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_CREATE',
        targetType: 'Phase',
        targetId: result.id,
        result: 'SUCCESS',
        metadata: { value: input.value },
      });

      return result;
    }),

  /**
   * Updates mutable fields of a phase (label, order). `code` is re-derived from order automatically.
   *
   * @auth {phase_catalog:update}
   * @input {{ id: string, data: Partial<PhaseInputBaseSchema without value> }}
   * @output {Phase} — the updated phase.
   */
  update: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        id: z.string().uuid(),
        data: partialWithoutDefaults(PhaseInputBaseSchema.omit({ value: true })),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.phase.findUnique({ where: { id: input.id } });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fase non trovata' });
      }

      const order = input.data.order ?? item.order;

      const result = await ctx.prisma.phase.update({
        where: { id: input.id },
        data: { ...input.data, code: codeForOrder(order) },
      });

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_UPDATE',
        targetType: 'Phase',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: {},
      });

      return result;
    }),

  /**
   * Soft-deletes a phase (isActive=false).
   *
   * @auth {phase_catalog:update}
   * @input {{ id: string }} — UUID of the phase to deactivate.
   * @output {{ success: true }}
   */
  remove: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.phase.findUnique({ where: { id: input.id } });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fase non trovata' });
      }

      await ctx.prisma.phase.update({
        where: { id: input.id },
        data: { isActive: false },
      });

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_REMOVE',
        targetType: 'Phase',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { value: item.value },
      });

      return { success: true };
    }),

  /**
   * Restores a soft-deleted phase (isActive=true).
   *
   * @auth {phase_catalog:update}
   * @input {{ id: string }} — UUID of the phase to restore.
   * @output {{ success: true }}
   */
  restore: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.phase.findUnique({ where: { id: input.id } });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fase non trovata' });
      }

      await ctx.prisma.phase.update({
        where: { id: input.id },
        data: { isActive: true },
      });

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_RESTORE',
        targetType: 'Phase',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { value: item.value },
      });

      return { success: true };
    }),

  /**
   * Reorders phases by assigning new position indices.
   *
   * @auth {phase_catalog:update}
   * @input {{ orderedIds: string[] }} — full ordered array of UUIDs.
   * @output {{ success: true }}
   */
  reorder: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ orderedIds: z.array(z.string().uuid()) }))
    .mutation(async ({ input, ctx }) => {
      await ctx.prisma.$transaction(
        input.orderedIds.map((id, index) =>
          ctx.prisma.phase.update({
            where: { id },
            data: { order: index, code: codeForOrder(index) },
          })
        )
      );

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_REORDER',
        targetType: 'Phase',
        targetId: 'phase_catalog',
        result: 'SUCCESS',
        metadata: { count: input.orderedIds.length },
      });

      return { success: true };
    }),
});
