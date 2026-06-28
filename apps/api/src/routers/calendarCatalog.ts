import { z } from 'zod';

import { CalendarCatalogItemCreateSchema, CalendarCatalogItemUpdateSchema } from '@luke/core';

import { TRPCError } from '@trpc/server';

import { logAudit } from '../lib/auditLog';
import { withRateLimit } from '../lib/ratelimit';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';

const CALENDAR_CATALOG_TYPES = ['eventType'] as const;
const CatalogTypeSchema = z.enum(CALENDAR_CATALOG_TYPES);

export const calendarCatalogRouter = router({
  /**
   * Lists active calendar catalog items of a given type, ordered by position.
   *
   * @auth {calendar_catalog:read}
   * @input {{ type: CatalogTypeSchema }} — catalog type to filter (e.g. "eventType").
   * @output {CalendarCatalogItem[]} — ordered list of active items for the requested type.
   */
  list: protectedProcedure
    .use(requirePermission('calendar_catalog:read'))
    .input(z.object({ type: CatalogTypeSchema }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.calendarCatalogItem.findMany({
        where: { type: input.type, isActive: true },
        orderBy: { order: 'asc' },
      });
    }),

  /**
   * Lists all calendar catalog items (including inactive) for admin management.
   *
   * @auth {calendar_catalog:update}
   * @input {{ type?: CatalogTypeSchema }} — optional type filter; if omitted returns all types.
   * @output {CalendarCatalogItem[]} — full list sorted by type then position, including inactive.
   */
  listAll: protectedProcedure
    .use(requirePermission('calendar_catalog:update'))
    .input(z.object({ type: CatalogTypeSchema.optional() }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.calendarCatalogItem.findMany({
        where: input.type ? { type: input.type } : undefined,
        orderBy: [{ type: 'asc' }, { order: 'asc' }],
      });
    }),

  /**
   * Creates a new calendar catalog item for a given type.
   *
   * @auth {calendar_catalog:update}
   * @input {CalendarCatalogItemCreateSchema} — type, value (unique per type), label, optional order.
   * @output {CalendarCatalogItem} — the newly created item.
   */
  create: protectedProcedure
    .use(requirePermission('calendar_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(CalendarCatalogItemCreateSchema)
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.prisma.calendarCatalogItem.findUnique({
        where: { type_value: { type: input.type, value: input.value } },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Il valore '${input.value}' esiste già per il tipo '${input.type}'`,
        });
      }

      const maxOrder = await ctx.prisma.calendarCatalogItem.aggregate({
        where: { type: input.type },
        _max: { order: true },
      });

      const result = await ctx.prisma.calendarCatalogItem.create({
        data: {
          type: input.type,
          value: input.value,
          label: input.label,
          order: input.order ?? (maxOrder._max.order ?? -1) + 1,
        },
      });

      await logAudit(ctx, {
        action: 'CALENDAR_CATALOG_CREATE',
        targetType: 'CalendarCatalogItem',
        targetId: result.id,
        result: 'SUCCESS',
        metadata: { type: input.type, value: input.value },
      });

      return result;
    }),

  /**
   * Updates label or order of an existing calendar catalog item.
   *
   * @auth {calendar_catalog:update}
   * @input {CalendarCatalogItemUpdateSchema} — id, optional label, optional order.
   * @output {CalendarCatalogItem} — the updated item.
   */
  update: protectedProcedure
    .use(requirePermission('calendar_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(CalendarCatalogItemUpdateSchema)
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.calendarCatalogItem.findUnique({
        where: { id: input.id },
      });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item non trovato' });
      }

      const result = await ctx.prisma.calendarCatalogItem.update({
        where: { id: input.id },
        data: {
          label: input.label,
          ...(input.order !== undefined && { order: input.order }),
        },
      });

      await logAudit(ctx, {
        action: 'CALENDAR_CATALOG_UPDATE',
        targetType: 'CalendarCatalogItem',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: {},
      });

      return result;
    }),

  /**
   * Soft-deletes a calendar catalog item (sets isActive=false).
   *
   * @auth {calendar_catalog:update}
   * @input {{ id: string }} — UUID of the item to deactivate.
   * @output {{ success: true }}
   */
  remove: protectedProcedure
    .use(requirePermission('calendar_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.calendarCatalogItem.findUnique({
        where: { id: input.id },
      });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item non trovato' });
      }

      await ctx.prisma.calendarCatalogItem.update({
        where: { id: input.id },
        data: { isActive: false },
      });

      await logAudit(ctx, {
        action: 'CALENDAR_CATALOG_REMOVE',
        targetType: 'CalendarCatalogItem',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { type: item.type, value: item.value },
      });

      return { success: true };
    }),

  /**
   * Restores a soft-deleted calendar catalog item (sets isActive=true).
   *
   * @auth {calendar_catalog:update}
   * @input {{ id: string }} — UUID of the item to reactivate.
   * @output {{ success: true }}
   */
  restore: protectedProcedure
    .use(requirePermission('calendar_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.calendarCatalogItem.findUnique({
        where: { id: input.id },
      });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item non trovato' });
      }

      await ctx.prisma.calendarCatalogItem.update({
        where: { id: input.id },
        data: { isActive: true },
      });

      await logAudit(ctx, {
        action: 'CALENDAR_CATALOG_RESTORE',
        targetType: 'CalendarCatalogItem',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { type: item.type, value: item.value },
      });

      return { success: true };
    }),

  /**
   * Reorders calendar catalog items by assigning new position indices.
   *
   * @auth {calendar_catalog:update}
   * @input {{ type: CatalogTypeSchema, orderedIds: string[] }} — type + full ordered array of UUIDs.
   * @output {{ success: true }}
   */
  reorder: protectedProcedure
    .use(requirePermission('calendar_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        type: CatalogTypeSchema,
        orderedIds: z.array(z.string().uuid()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await ctx.prisma.$transaction(
        input.orderedIds.map((id, index) =>
          ctx.prisma.calendarCatalogItem.update({
            where: { id },
            data: { order: index },
          })
        )
      );

      await logAudit(ctx, {
        action: 'CALENDAR_CATALOG_REORDER',
        targetType: 'CalendarCatalogItem',
        targetId: input.type,
        result: 'SUCCESS',
        metadata: { type: input.type, count: input.orderedIds.length },
      });

      return { success: true };
    }),
});
