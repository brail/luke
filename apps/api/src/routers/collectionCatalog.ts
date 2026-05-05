/**
 * Router tRPC per Collection Catalog Items
 * Gestisce le opzioni configurabili dei campi Collection Layout:
 * strategy, lineStatus, styleStatus, progress
 */

import { z } from 'zod';

import {
  COLLECTION_CATALOG_TYPES,
  CollectionCatalogItemInputSchema,
} from '@luke/core';

import { TRPCError } from '@trpc/server';

import { logAudit } from '../lib/auditLog';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';
import { requirePermission } from '../lib/permissions';

const CatalogTypeSchema = z.enum(COLLECTION_CATALOG_TYPES);

export const collectionCatalogRouter = router({
  /** Lista items attivi per tipo — usato nei select del frontend */
  list: protectedProcedure
    .use(requirePermission('collection_layout:read'))
    .input(z.object({ type: CatalogTypeSchema }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.collectionCatalogItem.findMany({
        where: { type: input.type, isActive: true },
        orderBy: { order: 'asc' },
      });
    }),

  /** Lista tutti gli items (inclusi inattivi) — per admin */
  listAll: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .input(z.object({ type: CatalogTypeSchema.optional() }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.collectionCatalogItem.findMany({
        where: input.type ? { type: input.type } : undefined,
        orderBy: [{ type: 'asc' }, { order: 'asc' }],
      });
    }),

  create: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(CollectionCatalogItemInputSchema)
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.prisma.collectionCatalogItem.findUnique({
        where: { type_value: { type: input.type, value: input.value } },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Il valore '${input.value}' esiste già per il tipo '${input.type}'`,
        });
      }

      const maxOrder = await ctx.prisma.collectionCatalogItem.aggregate({
        where: { type: input.type },
        _max: { order: true },
      });

      const result = await ctx.prisma.collectionCatalogItem.create({
        data: {
          type: input.type,
          value: input.value,
          label: input.label,
          order: input.order ?? (maxOrder._max.order ?? -1) + 1,
        },
      });

      await logAudit(ctx, {
        action: 'COLLECTION_CATALOG_CREATE',
        targetType: 'CollectionCatalogItem',
        targetId: result.id,
        result: 'SUCCESS',
        metadata: { type: input.type, value: input.value },
      });

      return result;
    }),

  update: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        id: z.string().uuid(),
        data: CollectionCatalogItemInputSchema.omit({ type: true }).partial(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.collectionCatalogItem.findUnique({
        where: { id: input.id },
      });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item non trovato' });
      }

      const result = await ctx.prisma.collectionCatalogItem.update({
        where: { id: input.id },
        data: input.data,
      });

      await logAudit(ctx, {
        action: 'COLLECTION_CATALOG_UPDATE',
        targetType: 'CollectionCatalogItem',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: {},
      });

      return result;
    }),

  remove: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.collectionCatalogItem.findUnique({
        where: { id: input.id },
      });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item non trovato' });
      }

      await ctx.prisma.collectionCatalogItem.update({
        where: { id: input.id },
        data: { isActive: false },
      });

      await logAudit(ctx, {
        action: 'COLLECTION_CATALOG_REMOVE',
        targetType: 'CollectionCatalogItem',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { type: item.type, value: item.value },
      });

      return { success: true };
    }),

  restore: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.collectionCatalogItem.findUnique({
        where: { id: input.id },
      });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item non trovato' });
      }

      await ctx.prisma.collectionCatalogItem.update({
        where: { id: input.id },
        data: { isActive: true },
      });

      await logAudit(ctx, {
        action: 'COLLECTION_CATALOG_RESTORE',
        targetType: 'CollectionCatalogItem',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { type: item.type, value: item.value },
      });

      return { success: true };
    }),

  reorder: protectedProcedure
    .use(requirePermission('collection_layout:update'))
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
          ctx.prisma.collectionCatalogItem.update({
            where: { id },
            data: { order: index },
          })
        )
      );

      await logAudit(ctx, {
        action: 'COLLECTION_CATALOG_REORDER',
        targetType: 'CollectionCatalogItem',
        targetId: input.type,
        result: 'SUCCESS',
        metadata: { type: input.type, count: input.orderedIds.length },
      });

      return { success: true };
    }),
});
