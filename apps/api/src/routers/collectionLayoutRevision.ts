import { z } from 'zod';

import {
  CreateRevisionInputSchema,
  GetRevisionsListInputSchema,
  GetRevisionDetailInputSchema,
  GetLayoutAsOfRevisionInputSchema,
} from '@luke/core';

import { TRPCError } from '@trpc/server';

import { logAudit } from '../lib/auditLog';
import { exportTimestamp } from '../lib/export/xlsx-streaming';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';
import { requirePermission } from '../lib/permissions';
import { copyToImmutableBucket } from '../storage';
import {
  createRevision,
  listRevisions,
  getRevisionDetail,
  getLayoutAsOfRevision,
} from '../services/collectionLayoutRevision.service';
import { buildRevisionXlsx, buildRevisionPdf } from '../services/collectionLayout.export.revision.service';

export const collectionLayoutRevisionRouter = router({
  create: protectedProcedure
    .use(requirePermission('collection_layout:revise'))
    .use(withRateLimit('configMutations'))
    .input(CreateRevisionInputSchema)
    .mutation(async ({ input, ctx }) => {
      if (input.cause === 'MILESTONE') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Le revisioni MILESTONE sono create automaticamente dal sistema al completamento di un evento calendario',
        });
      }

      const copyPhoto = (sourceKey: string) =>
        copyToImmutableBucket(ctx.prisma, sourceKey, ctx.logger);

      const revision = await createRevision(
        input,
        ctx.session.user.id,
        copyPhoto,
        ctx.prisma,
      );

      await logAudit(ctx, {
        action: 'COLLECTION_LAYOUT_REVISION_CREATE',
        targetType: 'CollectionLayoutRevision',
        targetId: revision.id,
        result: 'SUCCESS',
        metadata: {
          collectionLayoutId: input.collectionLayoutId,
          revisionNumber: revision.revisionNumber,
          revisionTypeValue: input.revisionTypeValue,
          cause: input.cause,
          milestoneId: input.milestoneId ?? undefined,
          rowsIncluded: input.includedRowIds.length,
        },
      });

      return revision;
    }),

  list: protectedProcedure
    .use(requirePermission('collection_layout:view_revisions'))
    .input(GetRevisionsListInputSchema)
    .query(async ({ input, ctx }) => {
      return listRevisions(input.collectionLayoutId, ctx.prisma);
    }),

  getDetail: protectedProcedure
    .use(requirePermission('collection_layout:view_revisions'))
    .input(GetRevisionDetailInputSchema)
    .query(async ({ input, ctx }) => {
      return getRevisionDetail(input.revisionId, ctx.prisma);
    }),

  getLayoutAsOf: protectedProcedure
    .use(requirePermission('collection_layout:view_revisions'))
    .input(GetLayoutAsOfRevisionInputSchema)
    .query(async ({ input, ctx }) => {
      return getLayoutAsOfRevision(
        input.collectionLayoutId,
        input.revisionId,
        ctx.prisma,
      );
    }),

  export: router({
    xlsx: protectedProcedure
      .use(requirePermission('collection_layout:read'))
      .input(z.object({
        revisionId: z.string().uuid(),
        collectionLayoutId: z.string().uuid(),
      }))
      .mutation(async ({ input, ctx }) => {
        const revision = await ctx.prisma.collectionLayoutRevision.findUniqueOrThrow({
          where: { id: input.revisionId },
          select: { revisionNumber: true, revisionTypeValue: true, collectionLayout: { select: { brand: { select: { code: true } }, season: { select: { code: true } } } } },
        });
        const buf = await buildRevisionXlsx(input.revisionId, input.collectionLayoutId, ctx.prisma, ctx.logger);
        const { brand, season } = revision.collectionLayout;
        return {
          data: buf.toString('base64'),
          filename: `${brand.code}-${season.code}-rev${revision.revisionNumber}-${revision.revisionTypeValue}-${exportTimestamp()}.xlsx`,
        };
      }),

    pdf: protectedProcedure
      .use(requirePermission('collection_layout:read'))
      .input(z.object({
        revisionId: z.string().uuid(),
        collectionLayoutId: z.string().uuid(),
      }))
      .mutation(async ({ input, ctx }) => {
        const revision = await ctx.prisma.collectionLayoutRevision.findUniqueOrThrow({
          where: { id: input.revisionId },
          select: { revisionNumber: true, revisionTypeValue: true, collectionLayout: { select: { brand: { select: { code: true } }, season: { select: { code: true } } } } },
        });
        const exportUser = await ctx.prisma.user.findUnique({
          where: { id: ctx.session.user.id },
          select: { firstName: true, lastName: true, username: true },
        });
        const fullName = exportUser
          ? [exportUser.firstName, exportUser.lastName].filter(Boolean).join(' ') || exportUser.username
          : ctx.session.user.email;
        const buf = await buildRevisionPdf(input.revisionId, input.collectionLayoutId, fullName, ctx.prisma, ctx.logger);
        const { brand, season } = revision.collectionLayout;
        return {
          data: buf.toString('base64'),
          filename: `${brand.code}-${season.code}-rev${revision.revisionNumber}-${revision.revisionTypeValue}-${exportTimestamp()}.pdf`,
        };
      }),
  }),
});
