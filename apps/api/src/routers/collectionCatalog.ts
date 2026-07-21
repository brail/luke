/**
 * Router tRPC per Collection Catalog Items
 * Gestisce le opzioni configurabili dei campi Collection Layout:
 * strategy, lineStatus, styleStatus, revisionType, pricePositioning
 * (la fase produzione è gestita dal catalogo Phase separato, vedi routers/phase.ts)
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  COLLECTION_CATALOG_TYPES,
  CollectionCatalogItemInputSchema,
  CollectionCatalogItemInputBaseSchema,
  partialWithoutDefaults,
} from '@luke/core';


import { logAudit } from '../lib/auditLog';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';

const CatalogTypeSchema = z.enum(COLLECTION_CATALOG_TYPES);

export const collectionCatalogRouter = router({
  /**
   * Lists active collection catalog items for a given type, used to populate frontend selects.
   *
   * @auth {collection_layout:read}
   * @input {{ type: CatalogTypeSchema }} — catalog type (strategy, lineStatus, styleStatus, progress).
   * @output {CollectionCatalogItem[]} — active items sorted by order.
   */
  list: protectedProcedure
    .use(requirePermission('collection_layout:read'))
    .input(z.object({ type: CatalogTypeSchema }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.collectionCatalogItem.findMany({
        where: { type: input.type, isActive: true },
        orderBy: { order: 'asc' },
      });
    }),

  /**
   * Lists all collection catalog items including inactive ones, for admin management.
   *
   * @auth {collection_layout:update}
   * @input {{ type?: CatalogTypeSchema }} — optional type filter.
   * @output {CollectionCatalogItem[]} — all items sorted by type then order.
   */
  listAll: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .input(z.object({ type: CatalogTypeSchema.optional() }))
    .query(async ({ input, ctx }) => {
      return ctx.prisma.collectionCatalogItem.findMany({
        where: input.type ? { type: input.type } : undefined,
        orderBy: [{ type: 'asc' }, { order: 'asc' }],
      });
    }),

  /**
   * Creates a new collection catalog item for the specified type.
   *
   * @auth {collection_layout:update}
   * @input {CollectionCatalogItemInputSchema} — type, value (unique per type), label, optional order.
   * @output {CollectionCatalogItem} — the newly created item.
   */
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
          iso9001Categories: input.iso9001Categories ?? [],
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

  /**
   * Updates mutable fields of a collection catalog item (label, order, code, iso9001Categories, etc.).
   *
   * @auth {collection_layout:update}
   * @input {{ id: string, data: Partial<CollectionCatalogItemInputBaseSchema without type> }}
   * @output {CollectionCatalogItem} — the updated item.
   */
  update: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        id: z.string().uuid(),
        data: partialWithoutDefaults(CollectionCatalogItemInputBaseSchema.omit({ type: true })),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.collectionCatalogItem.findUnique({
        where: { id: input.id },
      });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Item non trovato' });
      }

      const { iso9001Categories, ...restData } = input.data;
      const result = await ctx.prisma.collectionCatalogItem.update({
        where: { id: input.id },
        data: {
          ...restData,
          // Prisma array fields don't accept null — null means "clear to empty"
          ...(iso9001Categories !== undefined && { iso9001Categories: iso9001Categories ?? [] }),
        },
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

  /**
   * Soft-deletes a collection catalog item (isActive=false).
   *
   * @auth {collection_layout:update}
   * @input {{ id: string }} — UUID of the item to deactivate.
   * @output {{ success: true }}
   */
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

  /**
   * Restores a soft-deleted collection catalog item (isActive=true).
   *
   * @auth {collection_layout:update}
   * @input {{ id: string }} — UUID of the item to restore.
   * @output {{ success: true }}
   */
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

  /**
   * Reorders collection catalog items of a given type by assigning new position indices.
   *
   * @auth {collection_layout:update}
   * @input {{ type: CatalogTypeSchema, orderedIds: string[] }} — type and full ordered array of UUIDs.
   * @output {{ success: true }}
   */
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
