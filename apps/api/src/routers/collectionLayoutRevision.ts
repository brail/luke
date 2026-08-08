/**
 * tRPC router for collection layout revision management (ISO 9001 quality register).
 *
 * Exposes:
 *  - collectionLayoutRevision.create — snapshot the current layout as a numbered revision
 *  - collectionLayoutRevision.list   — list revisions for a layout
 *  - collectionLayoutRevision.getDetail — full detail of a single revision
 *  - collectionLayoutRevision.getLayoutAsOf — reconstruct the layout at a past revision
 *  - collectionLayoutRevision.export.xlsx / pdf — export a revision
 */

import { z } from 'zod';

import {
  CreateRevisionRequestSchema,
  GetRevisionsListInputSchema,
  GetRevisionDetailInputSchema,
  GetLayoutAsOfRevisionInputSchema,
} from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { exportTimestamp } from '../lib/export/xlsx-streaming';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';
import {
  resolveLayoutBrandAccess,
  resolveRevisionBrandAccess,
} from '../services/brandScope.service';
import { buildRevisionXlsx, buildRevisionPdf } from '../services/collectionLayout.export.revision.service';
import {
  createRevision,
  listRevisions,
  getRevisionDetail,
  getLayoutAsOfRevision,
} from '../services/collectionLayoutRevision.service';
import { copyToImmutableBucket } from '../storage';

export const collectionLayoutRevisionRouter = router({
  /**
   * Creates a new numbered revision snapshot of the current collection layout.
   *
   * Always a MANUAL revision: the input schema has no `cause`/`milestoneId`, so this endpoint
   * structurally cannot produce one of the automatic snapshots that the calendar triggers file
   * through the service. Row photos are copied to the immutable bucket.
   *
   * @auth collection_layout:revise
   * @input CreateRevisionRequestSchema
   * @output The created CollectionLayoutRevision record
   */
  create: protectedProcedure
    .use(requirePermission('collection_layout:revise'))
    .use(withRateLimit('configMutations'))
    .input(CreateRevisionRequestSchema)
    .mutation(async ({ input, ctx }) => {
      await resolveLayoutBrandAccess(ctx, input.collectionLayoutId);

      const copyPhoto = (sourceKey: string) =>
        copyToImmutableBucket(ctx.prisma, sourceKey, ctx.logger);

      const revision = await createRevision(
        { ...input, cause: 'MANUAL' },
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
          rowsIncluded: revision.groups.flatMap(g => g.rows).length,
        },
      });

      return revision;
    }),

  /**
   * Lists all revisions for a collection layout in chronological order.
   *
   * @auth collection_layout:view_revisions
   * @input GetRevisionsListInputSchema
   * @output Array of revision summaries
   */
  list: protectedProcedure
    .use(requirePermission('collection_layout:view_revisions'))
    .input(GetRevisionsListInputSchema)
    .query(async ({ input, ctx }) => {
      await resolveLayoutBrandAccess(ctx, input.collectionLayoutId);
      return listRevisions(input.collectionLayoutId, ctx.prisma);
    }),

  /**
   * Returns full detail for a single revision, including all snapshotted row data.
   *
   * @auth collection_layout:view_revisions
   * @input GetRevisionDetailInputSchema
   * @output Full CollectionLayoutRevision with snapshot rows
   */
  getDetail: protectedProcedure
    .use(requirePermission('collection_layout:view_revisions'))
    .input(GetRevisionDetailInputSchema)
    .query(async ({ input, ctx }) => {
      await resolveRevisionBrandAccess(ctx, input.revisionId);
      return getRevisionDetail(input.revisionId, ctx.prisma);
    }),

  /**
   * Reconstructs the collection layout as it was at a specific revision.
   *
   * @auth collection_layout:view_revisions
   * @input GetLayoutAsOfRevisionInputSchema
   * @output Layout snapshot data as of the specified revision
   */
  getLayoutAsOf: protectedProcedure
    .use(requirePermission('collection_layout:view_revisions'))
    .input(GetLayoutAsOfRevisionInputSchema)
    .query(async ({ input, ctx }) => {
      await resolveRevisionBrandAccess(ctx, input.revisionId);
      return getLayoutAsOfRevision(
        input.collectionLayoutId,
        input.revisionId,
        ctx.prisma,
      );
    }),

  export: router({
    /**
     * Exports a single revision as an XLSX workbook (base64-encoded).
     *
     * @auth collection_layout:read
     * @input { revisionId: string } — collectionLayoutId is derived from the revision, not passed separately (see comment below).
     * @output { data: string, filename: string } — base64-encoded XLSX buffer and generated filename.
     */
    xlsx: protectedProcedure
      .use(requirePermission('collection_layout:read'))
      // `collectionLayoutId` non è più un input: lo porta la revisione. Erano due
      // id indipendenti e nessuno verificava che il secondo fosse davvero il
      // layout del primo, quindi si poteva esportare una revisione montandola su
      // un altro layout. Il brand scope chiude il caso cross-brand, non quello
      // cross-layout dentro lo stesso brand — qui l'incoerenza smette proprio di
      // essere esprimibile.
      .input(z.object({ revisionId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        const { collectionLayoutId } = await resolveRevisionBrandAccess(ctx, input.revisionId);

        const revision = await ctx.prisma.collectionLayoutRevision.findUniqueOrThrow({
          where: { id: input.revisionId },
          select: { revisionNumber: true, revisionTypeValue: true, notes: true, collectionLayout: { select: { brand: { select: { code: true } }, season: { select: { code: true } } } } },
        });
        const buf = await buildRevisionXlsx(input.revisionId, collectionLayoutId, revision, ctx.prisma, ctx.logger);
        const { brand, season } = revision.collectionLayout;
        return {
          data: buf.toString('base64'),
          filename: `${brand.code}-${season.code}-rev${revision.revisionNumber}-${revision.revisionTypeValue}-${exportTimestamp()}.xlsx`,
        };
      }),

    /**
     * Exports a single revision as a PDF document (base64-encoded), including the exporting user's full name.
     *
     * @auth collection_layout:read
     * @input { revisionId: string } — collectionLayoutId is derived from the revision, not passed separately (see comment above).
     * @output { data: string, filename: string } — base64-encoded PDF buffer and generated filename.
     */
    pdf: protectedProcedure
      .use(requirePermission('collection_layout:read'))
      // Come sopra: il layout lo porta la revisione.
      .input(z.object({ revisionId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        const { collectionLayoutId } = await resolveRevisionBrandAccess(ctx, input.revisionId);

        const revision = await ctx.prisma.collectionLayoutRevision.findUniqueOrThrow({
          where: { id: input.revisionId },
          select: { revisionNumber: true, revisionTypeValue: true, notes: true, collectionLayout: { select: { brand: { select: { code: true } }, season: { select: { code: true } } } } },
        });
        const exportUser = await ctx.prisma.user.findUnique({
          where: { id: ctx.session.user.id },
          select: { firstName: true, lastName: true, username: true },
        });
        const fullName = exportUser
          ? [exportUser.firstName, exportUser.lastName].filter(Boolean).join(' ') || exportUser.username
          : ctx.session.user.email;
        const buf = await buildRevisionPdf(input.revisionId, collectionLayoutId, fullName, revision, ctx.prisma, ctx.logger);
        const { brand, season } = revision.collectionLayout;
        return {
          data: buf.toString('base64'),
          filename: `${brand.code}-${season.code}-rev${revision.revisionNumber}-${revision.revisionTypeValue}-${exportTimestamp()}.pdf`,
        };
      }),
  }),
});
