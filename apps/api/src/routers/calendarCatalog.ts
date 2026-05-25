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
  list: protectedProcedure
    .use(requirePermission('calendar_catalog:read'))
    .input(z.object({ type: CatalogTypeSchema }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.calendarCatalogItem.findMany({
        where: { type: input.type, isActive: true },
        orderBy: { order: 'asc' },
      });
    }),

  listAll: protectedProcedure
    .use(requirePermission('calendar_catalog:update'))
    .input(z.object({ type: CatalogTypeSchema.optional() }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.calendarCatalogItem.findMany({
        where: input.type ? { type: input.type } : undefined,
        orderBy: [{ type: 'asc' }, { order: 'asc' }],
      });
    }),

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
          color: input.color ?? null,
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
          color: input.color ?? null,
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
