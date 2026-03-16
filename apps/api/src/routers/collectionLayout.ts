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
      return createGroup(input.collectionLayoutId, input.data, ctx.prisma);
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
      return updateGroup(input.groupId, input.data, ctx.prisma);
    }),

  delete: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ groupId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await deleteGroup(input.groupId, ctx.prisma);
      return { success: true };
    }),
});

const rowsRouter = router({
  create: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(CollectionLayoutRowInputSchema)
    .mutation(async ({ input, ctx }) => {
      return createRow(input, ctx.prisma);
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
      return updateRow(input.rowId, input.data, ctx.prisma);
    }),

  delete: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ rowId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await deleteRow(input.rowId, ctx.prisma);
      return { success: true };
    }),

  duplicate: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ rowId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      return duplicateRow(input.rowId, ctx.prisma);
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
      return getOrCreateLayout(input.brandId, input.seasonId, ctx.prisma);
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
      return copyFromSeason(
        input.fromBrandId,
        input.fromSeasonId,
        input.toBrandId,
        input.toSeasonId,
        ctx.prisma
      );
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
      return { success: true };
    }),

  groups: groupsRouter,
  rows: rowsRouter,
});
