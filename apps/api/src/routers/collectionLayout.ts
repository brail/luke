/**
 * tRPC router for collection layout management.
 *
 * Exposes:
 *  - collectionLayout.get / getOrCreate / copyFromSeason / updateSettings
 *  - collectionLayout.groups.create / update / delete
 *  - collectionLayout.rows.create / update / delete / duplicate / reorder
 *  - collectionLayout.quotations.create / update / delete / reorder
 *  - collectionLayout.export.xlsx / pdf / rowXlsx / rowPdf
 */


import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  CollectionGroupInputSchema,
  CollectionLayoutRowInputSchema,
  CollectionLayoutBulkAssignPlanningGroupInputSchema,
  CollectionLayoutSettingsSchema,
  CollectionRowQuotationInputSchema,
  CollectionRowQuotationUpdateSchema,
  partialWithoutDefaults,
} from '@luke/core';


import { logAudit } from '../lib/auditLog';
import { exportTimestamp } from '../lib/export/xlsxStreaming';
import { confirmPendingFile } from '../lib/pendingFile';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { makeUrlResolver } from '../lib/storageUrl';
import { router, protectedProcedure } from '../lib/trpc';
import { resolveVariantUrls } from '../services/asset.service';
import {
  assertBrandAccess,
  assertBrandAccessAll,
  resolveGroupBrandAccess,
  resolveLayoutBrandAccess,
  resolveQuotationBrandAccess,
  resolveRowBrandAccess,
  resolveRowsBrandAccess,
} from '../services/brandScope.service';
import { buildCollectionLayoutPdf } from '../services/collectionLayout.export.pdf.service';
import {
  buildCollectionRowPdf,
  buildCollectionRowXlsx,
} from '../services/collectionLayout.export.row.service';
import { buildCollectionLayoutXlsx } from '../services/collectionLayout.export.xlsx.service';
import {
  getLayout,
  getOrCreateLayout,
  copyFromSeason,
  createGroup,
  updateGroup,
  deleteGroup,
  createRow,
  updateRow,
  setRowCompleted,
  deleteRow,
  duplicateRow,
  reorderRows,
  updateLayoutSettings,
  bulkAssignRowsPlanningGroup,
} from '../services/collectionLayout.service';
import { createRevisionsForCompletedPhase } from '../services/collectionLayoutAutoRevision.service';
import {
  createQuotation,
  updateQuotation,
  deleteQuotation,
  reorderQuotations,
  syncRowQuotations,
} from '../services/collectionRow.quotation.service';
import { assertUnlocked } from '../services/editLock.service';
import { resolveMissingPhasesForRow } from '../services/phaseAlert.service';
import { deleteObjectByKey } from '../storage';

import type { Context } from '../lib/trpc';
import type { QuotationSyncResult } from '../services/collectionRow.quotation.service';
import type { PrismaClient } from '@prisma/client';

const quotationsRouter = router({
  /**
   * Creates a price quotation for a collection layout row.
   *
   * @auth collection_layout:update
   * @input CollectionRowQuotationInputSchema — rowId plus the quotation fields (vendor, pricing parameter set, etc.)
   * @output The created CollectionRowQuotation record.
   */
  create: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(CollectionRowQuotationInputSchema)
    .mutation(async ({ input, ctx }) => {
      await resolveRowBrandAccess(ctx, input.rowId);
      const result = await createQuotation(input, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_QUOTATION_CREATE', targetType: 'CollectionRowQuotation', targetId: result.id, result: 'SUCCESS', metadata: { rowId: input.rowId } });
      return result;
    }),

  /**
   * Updates an existing row quotation.
   *
   * @auth collection_layout:update
   * @input { quotationId: string (uuid), data: CollectionRowQuotationUpdateSchema }
   * @output The updated CollectionRowQuotation record.
   */
  update: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ quotationId: z.string().uuid(), data: CollectionRowQuotationUpdateSchema }))
    .mutation(async ({ input, ctx }) => {
      await resolveQuotationBrandAccess(ctx, input.quotationId);
      const result = await updateQuotation(input.quotationId, input.data, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_QUOTATION_UPDATE', targetType: 'CollectionRowQuotation', targetId: input.quotationId, result: 'SUCCESS', metadata: {} });
      return result;
    }),

  /**
   * Deletes a row quotation.
   *
   * @auth collection_layout:update
   * @input { quotationId: string (uuid) }
   * @output { success: true }
   */
  delete: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ quotationId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await resolveQuotationBrandAccess(ctx, input.quotationId);
      await deleteQuotation(input.quotationId, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_QUOTATION_DELETE', targetType: 'CollectionRowQuotation', targetId: input.quotationId, result: 'SUCCESS', metadata: {} });
      return { success: true };
    }),

  /**
   * Reorders the quotations attached to a row.
   *
   * @auth collection_layout:update
   * @input { rowId: string (uuid), orderedIds: string[] (uuid) — new quotation order }
   * @output { success: true }
   */
  reorder: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ rowId: z.string().uuid(), orderedIds: z.array(z.string().uuid()) }))
    .mutation(async ({ input, ctx }) => {
      await resolveRowBrandAccess(ctx, input.rowId);
      await reorderQuotations(input.rowId, input.orderedIds, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_QUOTATION_REORDER', targetType: 'CollectionLayoutRow', targetId: input.rowId, result: 'SUCCESS', metadata: { count: input.orderedIds.length } });
      return { success: true };
    }),
});

const groupsRouter = router({
  /**
   * Creates a new group within a collection layout.
   *
   * @auth collection_layout:update
   * @input { collectionLayoutId: string, data: CollectionGroupInputSchema }
   * @output The created CollectionGroup record.
   */
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
      await resolveLayoutBrandAccess(ctx, input.collectionLayoutId);
      await assertUnlocked('COLLECTION_LAYOUT', input.collectionLayoutId, ctx.session!.user.id, ctx.prisma);
      const result = await createGroup(input.collectionLayoutId, input.data, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_GROUP_CREATE', targetType: 'CollectionGroup', targetId: result.id, result: 'SUCCESS', metadata: { collectionLayoutId: input.collectionLayoutId } });
      return result;
    }),

  /**
   * Updates an existing collection group.
   *
   * @auth collection_layout:update
   * @input { groupId: string, data: partial CollectionGroupInputSchema fields }
   * @output The updated CollectionGroup record.
   */
  update: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        groupId: z.string(),
        data: partialWithoutDefaults(CollectionGroupInputSchema),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await resolveGroupBrandAccess(ctx, input.groupId);
      const result = await updateGroup(input.groupId, input.data, ctx.prisma, ctx.session!.user.id);
      await logAudit(ctx, { action: 'COLLECTION_GROUP_UPDATE', targetType: 'CollectionGroup', targetId: input.groupId, result: 'SUCCESS', metadata: {} });
      return result;
    }),

  /**
   * Deletes a collection group.
   *
   * @auth collection_layout:update
   * @input { groupId: string }
   * @output { success: true }
   */
  delete: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ groupId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await resolveGroupBrandAccess(ctx, input.groupId);
      await deleteGroup(input.groupId, ctx.prisma, ctx.session!.user.id);
      await logAudit(ctx, { action: 'COLLECTION_GROUP_DELETE', targetType: 'CollectionGroup', targetId: input.groupId, result: 'SUCCESS', metadata: {} });
      return { success: true };
    }),
});

/**
 * Per-quotation audit entries for a `syncRowQuotations` result — same action codes and metadata
 * shape as the standalone `quotations.create/update/delete` endpoints, batched here since the
 * buffered row save fires them all after one Save instead of one per blur/click. Returns unfired
 * promises to spread into the caller's own `Promise.all` alongside its row-level `logAudit`
 * (`rows.create`/`update`) — not awaited here, so the two stay one atomic batch of independent
 * audit inserts instead of two sequential rounds.
 */
function quotationSyncAuditPromises(ctx: Context, rowId: string, sync: QuotationSyncResult) {
  return [
    ...sync.created.map(q =>
      logAudit(ctx, { action: 'COLLECTION_QUOTATION_CREATE', targetType: 'CollectionRowQuotation', targetId: q.id, result: 'SUCCESS', metadata: { rowId } })
    ),
    ...sync.updated.map(q =>
      logAudit(ctx, { action: 'COLLECTION_QUOTATION_UPDATE', targetType: 'CollectionRowQuotation', targetId: q.id, result: 'SUCCESS', metadata: {} })
    ),
    ...sync.deletedIds.map(id =>
      logAudit(ctx, { action: 'COLLECTION_QUOTATION_DELETE', targetType: 'CollectionRowQuotation', targetId: id, result: 'SUCCESS', metadata: {} })
    ),
  ];
}

const rowsRouter = router({
  /**
   * Creates a new row within a collection group, optionally confirming a pending picture upload
   * and syncing the row's quotations in the same transaction.
   *
   * @auth collection_layout:update
   * @input CollectionLayoutRowInputSchema — row fields plus optional pendingPictureFileObjectId, quotations[], phaseChangeNote
   * @output The created CollectionLayoutRow record.
   */
  create: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(CollectionLayoutRowInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { pendingPictureFileObjectId, quotations, phaseChangeNote: _phaseChangeNote, ...rowInput } = input;

      // Before opening the transaction: the membership lookup shouldn't
      // consume the 15s budget, and a rejection shouldn't cost a rollback.
      const group = await resolveGroupBrandAccess(ctx, rowInput.groupId);
      const layoutScope = { brandId: group.collectionLayout.brandId, seasonId: group.collectionLayout.seasonId };

      const { result, quotationsSync } = await ctx.prisma.$transaction(async tx => {
        let confirmedPictureKey: string | undefined;
        if (pendingPictureFileObjectId) {
          confirmedPictureKey =
            (await confirmPendingFile(tx, {
              fileObjectId: pendingPictureFileObjectId,
              bucket: 'collection-row-pictures',
              userId: ctx.session!.user.id,
            })) ?? undefined;
        }
        const row = await createRow(
          { ...rowInput, ...(confirmedPictureKey ? { pictureKey: confirmedPictureKey } : {}) },
          tx,
          ctx.session!.user.id
        );
        const sync = await syncRowQuotations(row.id, quotations ?? [], layoutScope, tx);
        return { result: row, quotationsSync: sync };
      }, { timeout: 15000 });

      // An independent INSERT per audit row (row + each quotation), not nested inside the
      // row transaction (already closed) — no dependency between them, a single Promise.all instead
      // of two sequential passes.
      await Promise.all([
        logAudit(ctx, { action: 'COLLECTION_ROW_CREATE', targetType: 'CollectionLayoutRow', targetId: result.id, result: 'SUCCESS', metadata: { groupId: result.groupId } }),
        ...quotationSyncAuditPromises(ctx, result.id, quotationsSync),
      ]);
      return result;
    }),

  /**
   * Updates an existing row, including its picture, phase/planning group assignment, and quotations.
   *
   * @auth collection_layout:update
   * @input { rowId: string, data: partial CollectionLayoutRowInputSchema fields }
   * @output The updated CollectionLayoutRow record.
   */
  update: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        rowId: z.string(),
        data: partialWithoutDefaults(CollectionLayoutRowInputSchema),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { pendingPictureFileObjectId, quotations, phaseChangeNote, ...rowData } = input.data;
      let oldPictureKey: string | null = null;

      // Outside the transaction, as in `create`.
      const rowAccess = await resolveRowBrandAccess(ctx, input.rowId);
      const layoutScope = { brandId: rowAccess.collectionLayout.brandId, seasonId: rowAccess.collectionLayout.seasonId };

      const { result, before, quotationsSync } = await ctx.prisma.$transaction(async tx => {
        // Independent (the confirmation doesn't read `beforeRow`, the use of `beforeRow.pictureKey` below
        // happens only after both are resolved) — run in parallel instead of sequentially.
        const [beforeRow, confirmedKey] = await Promise.all([
          // Unconditional (not only when there's a pending photo): always needed for the
          // phase/group diff used in the consolidated audit log below, and as `existingRow` for `updateRow`
          // (a single row fetch instead of one per function that needs it).
          tx.collectionLayoutRow.findUniqueOrThrow({
            where: { id: input.rowId },
            select: { pictureKey: true, phaseId: true, planningGroupId: true, collectionLayoutId: true, groupId: true, completedAt: true },
          }),
          pendingPictureFileObjectId
            ? confirmPendingFile(tx, {
                fileObjectId: pendingPictureFileObjectId,
                bucket: 'collection-row-pictures',
                userId: ctx.session!.user.id,
              })
            : Promise.resolve(undefined),
        ]);

        let confirmedPictureKey: string | undefined;
        if (confirmedKey) {
          confirmedPictureKey = confirmedKey;
          oldPictureKey = beforeRow.pictureKey ?? null;
        }

        const row = await updateRow(
          input.rowId,
          { ...rowData, ...(confirmedPictureKey ? { pictureKey: confirmedPictureKey } : {}) },
          beforeRow,
          tx,
          ctx.session!.user.id
        );

        const sync = quotations !== undefined
          ? await syncRowQuotations(input.rowId, quotations, layoutScope, tx)
          : { created: [], updated: [], deletedIds: [] };

        return { result: row, before: beforeRow, quotationsSync: sync };
      }, { timeout: 15000 });

      if (oldPictureKey) {
        try {
          await deleteObjectByKey(ctx, { bucket: 'collection-row-pictures', key: oldPictureKey });
        } catch (err) {
          ctx.logger?.warn({ err }, 'Failed to cleanup old picture after row update');
        }
      }

      const phaseChanged = rowData.phaseId !== undefined && rowData.phaseId !== (before.phaseId ?? null);
      const planningGroupChanged = rowData.planningGroupId !== undefined && rowData.planningGroupId !== before.planningGroupId;

      // An independent INSERT per audit row (row + each quotation touched) — no
      // dependency between them, a single Promise.all instead of two sequential passes.
      //
      // Alongside them, the automatic layout snapshot: this transition may be the one that
      // completes an event's phase for the entire planning group. It sits outside the
      // `$transaction` above because `createRevision` opens its own transaction, which can't be
      // nested in the save's transaction, and shares no data with the audits — so its queries run
      // overlapping with them instead of lengthening the mutation in series. It never throws (see the
      // service): a failed revision must not make the save fail.
      await Promise.all([
        ...(phaseChanged && rowData.phaseId != null
          ? [createRevisionsForCompletedPhase(ctx.prisma, before.collectionLayoutId, result.planningGroupId, ctx.logger)]
          : []),
        logAudit(ctx, {
          action: 'COLLECTION_ROW_UPDATE',
          targetType: 'CollectionLayoutRow',
          targetId: input.rowId,
          result: 'SUCCESS',
          metadata: {
            ...(phaseChanged ? { oldPhaseId: before.phaseId, newPhaseId: rowData.phaseId, ...(phaseChangeNote ? { phaseChangeNote } : {}) } : {}),
            ...(planningGroupChanged ? { oldPlanningGroupId: before.planningGroupId, newPlanningGroupId: rowData.planningGroupId } : {}),
          },
        }),
        ...quotationSyncAuditPromises(ctx, input.rowId, quotationsSync),
      ]);
      return result;
    }),

  /**
   * Deletes a collection layout row.
   *
   * @auth collection_layout:update
   * @input { rowId: string }
   * @output { success: true }
   */
  delete: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ rowId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await resolveRowBrandAccess(ctx, input.rowId);
      await deleteRow(input.rowId, ctx.prisma, ctx.session!.user.id);
      await logAudit(ctx, { action: 'COLLECTION_ROW_DELETE', targetType: 'CollectionLayoutRow', targetId: input.rowId, result: 'SUCCESS', metadata: {} });
      return { success: true };
    }),

  /**
   * Marks the row as concluded (or reopens it). Explicit state, not derivable from the calendar:
   * a row sitting on the last phase has *reached* it, not completed it — see
   * `getActivePhaseFromEvents`. Once concluded, the row exits the phase countdown and shows the
   * frozen outcome (`completionOutcome`), and the scheduler stops flagging it as overdue.
   *
   * Reopening clears `completedAt`; a phase change never touches it (a deliberate choice: reopening
   * is a declared action, not a side effect of a move made by mistake).
   *
   * A rationale is mandatory in both directions: conclusion is the only moment the outcome
   * gets fixed, and without a "why" the audit log would only say it happened.
   *
   * If the row hasn't passed through every planned phase, `force: true` is required — the list is
   * recomputed here, never accepted from the client. It's not a prohibition (skipping to the last
   * phase would bypass it anyway) but a record: `completionForced` and `skippedPhases` in the audit
   * make it possible, in hindsight, to tell cleanly closed rows apart from forced ones.
   *
   * @auth collection_layout:update
   * @input { rowId: string, completed: boolean, note: string (mandatory rationale, 1-500 chars), force?: boolean }
   * @output The updated CollectionLayoutRow record, with completedAt set or cleared.
   */
  setCompleted: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        rowId: z.string(),
        completed: z.boolean(),
        note: z.string().min(1, 'Motivazione obbligatoria').max(500),
        force: z.boolean().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await resolveRowBrandAccess(ctx, input.rowId);

      // Only when concluding: reopening skips nothing, it just puts the row back in progress.
      const missingPhases = input.completed
        ? await resolveMissingPhasesForRow(input.rowId, ctx.prisma)
        : [];
      if (missingPhases.length > 0 && input.force !== true) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A questa riga mancano queste fasi prima di poter considerare concluso lo sviluppo: ${missingPhases.map(p => p.label).join(', ')}. Conferma la forzatura per procedere.`,
        });
      }

      const row = await setRowCompleted(input.rowId, input.completed, ctx.prisma);

      await logAudit(ctx, {
        action: input.completed ? 'COLLECTION_ROW_COMPLETE' : 'COLLECTION_ROW_REOPEN',
        targetType: 'CollectionLayoutRow',
        targetId: input.rowId,
        result: 'SUCCESS',
        metadata: {
          completedAt: row.completedAt?.toISOString() ?? null,
          completionNote: input.note,
          ...(missingPhases.length > 0
            ? { completionForced: true, skippedPhases: missingPhases.map(p => p.value) }
            : {}),
        },
      });
      return row;
    }),

  /**
   * Duplicates a row within its group.
   *
   * @auth collection_layout:update
   * @input { rowId: string }
   * @output The newly created duplicate CollectionLayoutRow record.
   */
  duplicate: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ rowId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await resolveRowBrandAccess(ctx, input.rowId);
      const result = await duplicateRow(input.rowId, ctx.prisma, ctx.session!.user.id);
      await logAudit(ctx, { action: 'COLLECTION_ROW_DUPLICATE', targetType: 'CollectionLayoutRow', targetId: result.id, result: 'SUCCESS', metadata: { sourceRowId: input.rowId } });
      return result;
    }),

  /**
   * Reorders rows within a group.
   *
   * @auth collection_layout:update
   * @input { groupId: string, orderedIds: string[] — new row order }
   * @output { success: true }
   */
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
      await resolveGroupBrandAccess(ctx, input.groupId);
      await reorderRows(input.groupId, input.orderedIds, ctx.prisma, ctx.session!.user.id);
      await logAudit(ctx, { action: 'COLLECTION_ROW_REORDER', targetType: 'CollectionGroup', targetId: input.groupId, result: 'SUCCESS', metadata: { count: input.orderedIds.length } });
      return { success: true };
    }),

  /**
   * Bulk-assigns a planning group to multiple rows at once.
   *
   * @auth collection_layout:update
   * @input CollectionLayoutBulkAssignPlanningGroupInputSchema — { rowIds: string[], planningGroupId: string | null }
   * @output Result of the bulk update (affected row count).
   */
  bulkAssignPlanningGroup: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(CollectionLayoutBulkAssignPlanningGroupInputSchema)
    .mutation(async ({ input, ctx }) => {
      const collectionLayoutId = await resolveRowsBrandAccess(ctx, input.rowIds);

      const result = await bulkAssignRowsPlanningGroup(input.rowIds, collectionLayoutId, input.planningGroupId, ctx.prisma, ctx.session!.user.id);
      await logAudit(ctx, {
        action: 'COLLECTION_ROW_BULK_ASSIGN_PLANNING_GROUP',
        targetType: 'CollectionLayoutRow',
        targetId: input.rowIds.join(','),
        result: 'SUCCESS',
        metadata: { count: result.count, planningGroupId: input.planningGroupId },
      });
      return result;
    }),
});

/**
 * Resolves `pictureKey` → `pictureUrl` for each row and `logoKey` → `logoUrl` for the brand
 * in a layout response, using the active storage provider to build URLs.
 *
 * Row pictures serve the `card` derivative (800px, WebP) rather than the master —
 * the same `pictureUrl` field feeds both the grid thumbnail and the row drawer
 * preview, and `card` fits both without a second field on the contract. Brand
 * logos serve `thumb` instead: `ASSET_KINDS['brand-logo'].variants` never includes
 * `card` (only `thumb`/`export`, see `@luke/core/storage/assets`), so requesting
 * `card` here would always miss and silently fall back to the full-size master.
 * Falls back to the master's own URL for a row/logo whose derivative isn't ready
 * yet (just uploaded, or the background worker hasn't caught up) — never a broken
 * image. One batched query per bucket for the whole layout via `resolveVariantUrls`,
 * not N — and one shared URL resolver, not one per call.
 */
async function resolveLayoutUrls<T extends {
  brand: { logoKey: string | null; [k: string]: unknown };
  groups: Array<{ rows: Array<{ pictureKey: string | null; [k: string]: unknown }>; [k: string]: unknown }>;
  [k: string]: unknown;
}>(layout: T, prisma: PrismaClient): Promise<T & { brand: { logoUrl: string | null } }> {
  const resolve = await makeUrlResolver(prisma);

  const pictureKeys = layout.groups.flatMap(g => g.rows.map(r => r.pictureKey).filter((k): k is string => k !== null));
  const [pictureCardUrls, logoThumbUrls] = await Promise.all([
    resolveVariantUrls(prisma, 'collection-row-pictures', pictureKeys, 'card', resolve),
    layout.brand.logoKey
      ? resolveVariantUrls(prisma, 'brand-logos', [layout.brand.logoKey], 'thumb', resolve)
      : Promise.resolve(new Map<string, string>()),
  ]);

  return {
    ...layout,
    brand: {
      ...layout.brand,
      logoUrl: layout.brand.logoKey
        ? (logoThumbUrls.get(layout.brand.logoKey) ?? resolve('brand-logos', layout.brand.logoKey))
        : null,
    },
    groups: layout.groups.map(g => ({
      ...g,
      rows: g.rows.map(r => ({
        ...r,
        pictureUrl: r.pictureKey
          ? (pictureCardUrls.get(r.pictureKey) ?? resolve('collection-row-pictures', r.pictureKey))
          : null,
      })),
    })),
  } as T & { brand: { logoUrl: string | null } }; // spread di un T generico con override annidato: TS non verifica la forma esatta
}

/**
 * Builds the export `include` for a CollectionLayout, optionally pushing a row-id
 * filter into the nested `rows` relation so Prisma only loads the requested rows
 * instead of the whole layout (large layouts with many photos can OOM the process
 * otherwise — see COLLECTION_LAYOUT_EXPORT_XLSX incident).
 */
export function buildExportInclude(rowIds?: string[]) {
  return {
    brand:  { select: { name: true, code: true, logoKey: true } },
    season: { select: { name: true, code: true, year: true } },
    groups: {
      orderBy: { order: 'asc' as const },
      include: {
        rows: {
          where: rowIds && rowIds.length > 0 ? { id: { in: rowIds } } : undefined,
          orderBy: { order: 'asc' as const },
          include: {
            vendor: { select: { id: true, name: true, nickname: true } },
            quotations: {
              orderBy: { order: 'asc' as const },
              include: { pricingParameterSet: true },
            },
          },
        },
      },
    },
  } as const;
}

const ROW_EXPORT_INCLUDE = {
  vendor: { select: { id: true, name: true, nickname: true } },
  quotations: {
    orderBy: { order: 'asc' as const },
    include: { pricingParameterSet: true },
  },
  collectionLayout: {
    select: {
      brandId: true, seasonId: true,
      brand:  { select: { name: true, code: true, logoKey: true } },
      season: { select: { name: true, code: true, year: true } },
    },
  },
} as const;

const exportRouter = router({
  /**
   * Exports a single collection layout row as an Excel file.
   *
   * @auth collection_layout:read
   * @input { rowId: string (uuid) }
   * @output { data: base64-encoded xlsx buffer, filename: string }
   */
  rowXlsx: protectedProcedure
    .use(requirePermission('collection_layout:read'))
    .use(withRateLimit('exportGeneration'))
    .input(z.object({ rowId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.collectionLayoutRow.findUnique({
        where: { id: input.rowId },
        include: ROW_EXPORT_INCLUDE,
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Riga non trovata' });
      await assertBrandAccess(ctx, row.collectionLayout.brandId);

      const { collectionLayout, ...rowData } = row;
      const buffer = await buildCollectionRowXlsx(
        { brand: collectionLayout.brand, season: collectionLayout.season, row: rowData },
        ctx.prisma,
        ctx.logger,
      );
      await logAudit(ctx, {
        action: 'COLLECTION_ROW_EXPORT_XLSX',
        targetType: 'CollectionLayoutRow',
        targetId: input.rowId,
        result: 'SUCCESS',
        metadata: {},
      });
      return {
        data: buffer.toString('base64'),
        filename: `${collectionLayout.brand.code}-${rowData.line}-${exportTimestamp()}.xlsx`,
      };
    }),

  /**
   * Exports a single collection layout row as a PDF file.
   *
   * @auth collection_layout:read
   * @input { rowId: string (uuid) }
   * @output { data: base64-encoded pdf buffer, filename: string }
   */
  rowPdf: protectedProcedure
    .use(requirePermission('collection_layout:read'))
    .use(withRateLimit('exportGeneration'))
    .input(z.object({ rowId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.prisma.collectionLayoutRow.findUnique({
        where: { id: input.rowId },
        include: ROW_EXPORT_INCLUDE,
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Riga non trovata' });
      await assertBrandAccess(ctx, row.collectionLayout.brandId);

      const exportUser = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { firstName: true, lastName: true, username: true },
      });
      const fullName = exportUser
        ? [exportUser.firstName, exportUser.lastName].filter(Boolean).join(' ') || exportUser.username
        : ctx.session.user.username;

      const { collectionLayout, ...rowData } = row;
      const buffer = await buildCollectionRowPdf(
        { brand: collectionLayout.brand, season: collectionLayout.season, row: rowData },
        ctx.prisma,
        fullName,
        new Date(),
        ctx.logger,
      );
      await logAudit(ctx, {
        action: 'COLLECTION_ROW_EXPORT_PDF',
        targetType: 'CollectionLayoutRow',
        targetId: input.rowId,
        result: 'SUCCESS',
        metadata: {},
      });
      return {
        data: buffer.toString('base64'),
        filename: `${collectionLayout.brand.code}-${rowData.line}-${exportTimestamp()}.pdf`,
      };
    }),

  /**
   * Exports a full collection layout, optionally filtered to a subset of rows, as an Excel file.
   *
   * @auth collection_layout:read
   * @input { collectionLayoutId: string (uuid), rowIds?: string[] (uuid) — filter to specific rows }
   * @output { data: base64-encoded xlsx buffer, filename: string }
   */
  xlsx: protectedProcedure
    .use(requirePermission('collection_layout:read'))
    .use(withRateLimit('exportGeneration'))
    .input(z.object({
      collectionLayoutId: z.string().uuid(),
      rowIds: z.array(z.string().uuid()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const layout = await ctx.prisma.collectionLayout.findUnique({
        where: { id: input.collectionLayoutId },
        include: buildExportInclude(input.rowIds),
      });
      if (!layout) throw new TRPCError({ code: 'NOT_FOUND', message: 'Layout non trovato' });
      await assertBrandAccess(ctx, layout.brandId);

      const buffer = await buildCollectionLayoutXlsx(layout, ctx.prisma, ctx.logger);
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

  /**
   * Exports a full collection layout, optionally filtered to a subset of rows, as a PDF file.
   *
   * @auth collection_layout:read
   * @input { collectionLayoutId: string (uuid), rowIds?: string[] (uuid) — filter to specific rows }
   * @output { data: base64-encoded pdf buffer, filename: string }
   */
  pdf: protectedProcedure
    .use(requirePermission('collection_layout:read'))
    .use(withRateLimit('exportGeneration'))
    .input(z.object({
      collectionLayoutId: z.string().uuid(),
      rowIds: z.array(z.string().uuid()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const layout = await ctx.prisma.collectionLayout.findUnique({
        where: { id: input.collectionLayoutId },
        include: buildExportInclude(input.rowIds),
      });
      if (!layout) throw new TRPCError({ code: 'NOT_FOUND', message: 'Layout non trovato' });
      await assertBrandAccess(ctx, layout.brandId);

      const exportUser = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { firstName: true, lastName: true, username: true },
      });

      const fullName = exportUser
        ? [exportUser.firstName, exportUser.lastName].filter(Boolean).join(' ') || exportUser.username
        : ctx.session.user.username;

      const buffer = await buildCollectionLayoutPdf(layout, ctx.prisma, fullName, new Date(), ctx.logger);
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
  /**
   * Returns the collection layout for a brand/season pair, or `null` if none exists yet.
   *
   * @auth collection_layout:read
   * @input { brandId, seasonId }
   * @output CollectionLayout with resolved pictureUrls and logoUrl, or null
   */
  get: protectedProcedure
    .use(requirePermission('collection_layout:read'))
    .input(
      z.object({
        brandId: z.string().uuid('Brand ID non valido'),
        seasonId: z.string().uuid('Season ID non valido'),
      })
    )
    .query(async ({ input, ctx }) => {
      await assertBrandAccess(ctx, input.brandId);
      const layout = await getLayout(input.brandId, input.seasonId, ctx.prisma);
      return layout ? resolveLayoutUrls(layout, ctx.prisma) : null;
    }),

  /**
   * Returns the collection layout for a brand/season pair, creating one if it does not exist.
   *
   * @auth collection_layout:update
   * @input { brandId, seasonId, availableGenders? }
   * @output CollectionLayout with resolved URLs
   */
  getOrCreate: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        brandId: z.string().uuid(),
        seasonId: z.string().uuid(),
        availableGenders: z.array(z.string()).min(1).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      await assertBrandAccess(ctx, input.brandId);
      const result = await getOrCreateLayout(input.brandId, input.seasonId, ctx.prisma, input.availableGenders);
      await logAudit(ctx, { action: 'COLLECTION_LAYOUT_GET_OR_CREATE', targetType: 'CollectionLayout', targetId: result.id, result: 'SUCCESS', metadata: { brandId: input.brandId, seasonId: input.seasonId } });
      return resolveLayoutUrls(result, ctx.prisma);
    }),

  /**
   * Copies a collection layout (groups, rows, and optionally quotations) from one brand/season to another.
   *
   * @auth collection_layout:update
   * @input { fromBrandId, fromSeasonId, toBrandId, toSeasonId, rows? }
   * @output The resulting target layout with resolved URLs
   */
  copyFromSeason: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        fromBrandId: z.string().uuid(),
        fromSeasonId: z.string().uuid(),
        toBrandId: z.string().uuid(),
        toSeasonId: z.string().uuid(),
        rows: z.array(z.object({ id: z.string().uuid(), copyQuotations: z.boolean() })).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Both brands, not just one: checking only the source would allow writing
      // to a brand that isn't yours; checking only the destination is exfiltration —
      // read another brand's collection by cloning it into your own.
      await assertBrandAccessAll(ctx, [input.fromBrandId, input.toBrandId]);

      const result = await copyFromSeason(
        input.fromBrandId,
        input.fromSeasonId,
        input.toBrandId,
        input.toSeasonId,
        ctx.prisma,
        input.rows ? { rows: input.rows } : undefined
      );
      await logAudit(ctx, { action: 'COLLECTION_LAYOUT_COPY_FROM_SEASON', targetType: 'CollectionLayout', targetId: result.id, result: 'SUCCESS', metadata: { fromBrandId: input.fromBrandId, fromSeasonId: input.fromSeasonId, toBrandId: input.toBrandId, toSeasonId: input.toSeasonId, rowCount: input.rows?.length } });
      return resolveLayoutUrls(result, ctx.prisma);
    }),

  /**
   * Updates the column visibility and display settings for a collection layout.
   *
   * @auth collection_layout:update
   * @input { collectionLayoutId, ...CollectionLayoutSettings }
   * @output { success: true }
   */
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
      await resolveLayoutBrandAccess(ctx, collectionLayoutId);
      await updateLayoutSettings(collectionLayoutId, settings, ctx.prisma);
      await logAudit(ctx, { action: 'COLLECTION_LAYOUT_UPDATE_SETTINGS', targetType: 'CollectionLayout', targetId: collectionLayoutId, result: 'SUCCESS', metadata: {} });
      return { success: true };
    }),

  export: exportRouter,
  groups: groupsRouter,
  rows: rowsRouter,
  quotations: quotationsRouter,
});
