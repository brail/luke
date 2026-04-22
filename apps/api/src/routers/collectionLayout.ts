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

import { TRPCError } from '@trpc/server';

import type { PrismaClient } from '@prisma/client';

import { logAudit } from '../lib/auditLog';
import { withRateLimit } from '../lib/ratelimit';
import { makeUrlResolver } from '../lib/storageUrl';
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
import { buildCollectionLayoutXlsx } from '../services/collectionLayout.export.xlsx.service';
import { buildCollectionLayoutPdf } from '../services/collectionLayout.export.pdf.service';

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

/** Resolve pictureKey → pictureUrl and logoKey → logoUrl in a layout response. */
async function resolveLayoutUrls<T extends {
  brand: { logoKey: string | null; [k: string]: unknown };
  groups: Array<{ rows: Array<{ pictureKey: string | null; [k: string]: unknown }>; [k: string]: unknown }>;
  [k: string]: unknown;
}>(layout: T, prisma: PrismaClient): Promise<T & { brand: { logoUrl: string | null } }> {
  const resolve = await makeUrlResolver(prisma);
  return {
    ...layout,
    brand: {
      ...layout.brand,
      logoUrl: layout.brand.logoKey ? resolve('brand-logos', layout.brand.logoKey) : null,
    },
    groups: layout.groups.map(g => ({
      ...g,
      rows: g.rows.map(r => ({
        ...r,
        pictureUrl: r.pictureKey ? resolve('collection-row-pictures', r.pictureKey) : null,
      })),
    })),
  } as any;
}

const EXPORT_INCLUDE = {
  brand:  { select: { name: true, code: true, logoKey: true } },
  season: { select: { name: true, code: true, year: true } },
  groups: {
    orderBy: { order: 'asc' as const },
    include: {
      rows: {
        orderBy: { order: 'asc' as const },
        include: { vendor: { select: { id: true, name: true, nickname: true } } },
      },
    },
  },
} as const;

function exportTimestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

const exportRouter = router({
  xlsx: protectedProcedure
    .use(requirePermission('collection_layout:read'))
    .input(z.object({ collectionLayoutId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const layout = await ctx.prisma.collectionLayout.findUnique({
        where: { id: input.collectionLayoutId },
        include: EXPORT_INCLUDE,
      });
      if (!layout) throw new TRPCError({ code: 'NOT_FOUND', message: 'Layout non trovato' });

      const pricingSets = await ctx.prisma.pricingParameterSet.findMany({
        where: { brandId: layout.brandId, seasonId: layout.seasonId },
      });

      const buffer = await buildCollectionLayoutXlsx(layout, pricingSets, ctx.prisma);
      await logAudit(ctx, {
        action: 'COLLECTION_LAYOUT_EXPORT_XLSX',
        targetType: 'CollectionLayout',
        targetId: layout.id,
        result: 'SUCCESS',
        metadata: { brandId: layout.brandId, seasonId: layout.seasonId },
      });
      return {
        data: buffer.toString('base64'),
        filename: `${layout.brand.code}-${layout.season.code}-CollectionLayout-${exportTimestamp()}.xlsx`,
      };
    }),

  pdf: protectedProcedure
    .use(requirePermission('collection_layout:read'))
    .input(z.object({ collectionLayoutId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const layout = await ctx.prisma.collectionLayout.findUnique({
        where: { id: input.collectionLayoutId },
        include: EXPORT_INCLUDE,
      });
      if (!layout) throw new TRPCError({ code: 'NOT_FOUND', message: 'Layout non trovato' });

      const buffer = await buildCollectionLayoutPdf(layout, ctx.prisma);
      await logAudit(ctx, {
        action: 'COLLECTION_LAYOUT_EXPORT_PDF',
        targetType: 'CollectionLayout',
        targetId: layout.id,
        result: 'SUCCESS',
        metadata: { brandId: layout.brandId, seasonId: layout.seasonId },
      });
      return {
        data: buffer.toString('base64'),
        filename: `${layout.brand.code}-${layout.season.code}-CollectionLayout-${exportTimestamp()}.pdf`,
      };
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
      const layout = await getLayout(input.brandId, input.seasonId, ctx.prisma);
      return layout ? resolveLayoutUrls(layout, ctx.prisma) : null;
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
      return resolveLayoutUrls(result, ctx.prisma);
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
      return resolveLayoutUrls(result, ctx.prisma);
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

  export: exportRouter,
  groups: groupsRouter,
  rows: rowsRouter,
});
