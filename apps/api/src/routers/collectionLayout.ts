/**
 * Router tRPC per Collection Layout
 *
 * Espone:
 *  - collectionLayout.get
 *  - collectionLayout.getOrCreate
 *  - collectionLayout.copyFromSeason
 *  - collectionLayout.groups.create / update / delete
 *  - collectionLayout.rows.create / update / delete / duplicate / reorder
 */

import { z } from 'zod';

import {
  CollectionGroupInputSchema,
  CollectionLayoutRowInputSchema,
  CollectionLayoutSettingsSchema,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';
import { requirePermission } from '../lib/permissions';
import {
  getLayout,
  getOrCreateLayout,
  copyFromSeason,
  createGroup,
  updateGroup,
  deleteGroup,
  createRow,
  updateRow,
  deleteRow,
  duplicateRow,
  reorderRows,
  updateLayoutSettings,
} from '../services/collectionLayout.service';

const groupsRouter = router({
  create: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        collectionLayoutId: z.string(),
        data: CollectionGroupInputSchema,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await createGroup(input.collectionLayoutId, input.data, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_GROUP_CREATE', targetType: 'CollectionGroup', targetId: result.id, result: 'SUCCESS', metadata: { collectionLayoutId: input.collectionLayoutId } });
      return result;
    }),

  update: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        groupId: z.string(),
        data: CollectionGroupInputSchema.partial(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await updateGroup(input.groupId, input.data, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_GROUP_UPDATE', targetType: 'CollectionGroup', targetId: input.groupId, result: 'SUCCESS', metadata: {} });
      return result;
    }),

  delete: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ groupId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await deleteGroup(input.groupId, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_GROUP_DELETE', targetType: 'CollectionGroup', targetId: input.groupId, result: 'SUCCESS', metadata: {} });
      return { success: true };
    }),
});

const rowsRouter = router({
  create: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(CollectionLayoutRowInputSchema)
    .mutation(async ({ input, ctx }) => {
      const result = await createRow(input, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_ROW_CREATE', targetType: 'CollectionLayoutRow', targetId: result.id, result: 'SUCCESS', metadata: { groupId: result.groupId } });
      return result;
    }),

  update: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        rowId: z.string(),
        data: CollectionLayoutRowInputSchema.partial(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await updateRow(input.rowId, input.data, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_ROW_UPDATE', targetType: 'CollectionLayoutRow', targetId: input.rowId, result: 'SUCCESS', metadata: {} });
      return result;
    }),

  delete: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ rowId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await deleteRow(input.rowId, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_ROW_DELETE', targetType: 'CollectionLayoutRow', targetId: input.rowId, result: 'SUCCESS', metadata: {} });
      return { success: true };
    }),

  duplicate: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ rowId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const result = await duplicateRow(input.rowId, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_ROW_DUPLICATE', targetType: 'CollectionLayoutRow', targetId: result.id, result: 'SUCCESS', metadata: { sourceRowId: input.rowId } });
      return result;
    }),

  reorder: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        groupId: z.string(),
        orderedIds: z.array(z.string()),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await reorderRows(input.groupId, input.orderedIds, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_ROW_REORDER', targetType: 'CollectionGroup', targetId: input.groupId, result: 'SUCCESS', metadata: { count: input.orderedIds.length } });
      return { success: true };
    }),
});

export const collectionLayoutRouter = router({
  get: protectedProcedure
    .use(requirePermission('collection_layout:read'))
    .input(
      z.object({
        brandId: z.string().uuid('Brand ID non valido'),
        seasonId: z.string().uuid('Season ID non valido'),
      })
    )
    .query(async ({ input, ctx }) => {
      return getLayout(input.brandId, input.seasonId, ctx.prisma);
    }),

  getOrCreate: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        brandId: z.string().uuid(),
        seasonId: z.string().uuid(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await getOrCreateLayout(input.brandId, input.seasonId, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_LAYOUT_GET_OR_CREATE', targetType: 'CollectionLayout', targetId: result.id, result: 'SUCCESS', metadata: { brandId: input.brandId, seasonId: input.seasonId } });
      return result;
    }),

  copyFromSeason: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        fromBrandId: z.string().uuid(),
        fromSeasonId: z.string().uuid(),
        toBrandId: z.string().uuid(),
        toSeasonId: z.string().uuid(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const result = await copyFromSeason(
        input.fromBrandId,
        input.fromSeasonId,
        input.toBrandId,
        input.toSeasonId,
        ctx.prisma
      );
      await logAudit(ctx, { action: 'COLLECTION_LAYOUT_COPY_FROM_SEASON', targetType: 'CollectionLayout', targetId: result.id, result: 'SUCCESS', metadata: { fromBrandId: input.fromBrandId, fromSeasonId: input.fromSeasonId, toBrandId: input.toBrandId, toSeasonId: input.toSeasonId } });
      return result;
    }),

  updateSettings: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        collectionLayoutId: z.string(),
        ...CollectionLayoutSettingsSchema.shape,
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { collectionLayoutId, ...settings } = input;
      await updateLayoutSettings(collectionLayoutId, settings, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_LAYOUT_UPDATE_SETTINGS', targetType: 'CollectionLayout', targetId: collectionLayoutId, result: 'SUCCESS', metadata: {} });
      return { success: true };
    }),

  groups: groupsRouter,
  rows: rowsRouter,
});
