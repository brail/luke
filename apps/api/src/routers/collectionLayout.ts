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
import { exportTimestamp } from '../lib/export/xlsx-streaming';
import { confirmPendingFile } from '../lib/pendingFile';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { makeUrlResolver } from '../lib/storageUrl';
import { router, protectedProcedure } from '../lib/trpc';
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
  create: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(CollectionLayoutRowInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { pendingPictureFileObjectId, quotations, phaseChangeNote: _phaseChangeNote, ...rowInput } = input;

      // Prima di aprire la transaction: la lookup di membership non deve
      // consumare il budget dei 15s, e un rifiuto non deve costare un rollback.
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
          tx as any,
          ctx.session!.user.id
        );
        const sync = await syncRowQuotations(row.id, quotations ?? [], layoutScope, tx as any);
        return { result: row, quotationsSync: sync };
      }, { timeout: 15000 });

      // Un INSERT indipendente per riga di audit (riga + ciascuna quotazione), non annidati nella
      // transaction di riga (già chiusa) — nessuna dipendenza fra loro, un solo Promise.all invece
      // di due giri sequenziali.
      await Promise.all([
        logAudit(ctx, { action: 'COLLECTION_ROW_CREATE', targetType: 'CollectionLayoutRow', targetId: result.id, result: 'SUCCESS', metadata: { groupId: result.groupId } }),
        ...quotationSyncAuditPromises(ctx, result.id, quotationsSync),
      ]);
      return result;
    }),

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

      // Fuori dalla transaction, come in `create`.
      const rowAccess = await resolveRowBrandAccess(ctx, input.rowId);
      const layoutScope = { brandId: rowAccess.collectionLayout.brandId, seasonId: rowAccess.collectionLayout.seasonId };

      const { result, before, quotationsSync } = await ctx.prisma.$transaction(async tx => {
        // Indipendenti (la conferma non legge `beforeRow`, l'uso di `beforeRow.pictureKey` sotto
        // avviene solo dopo che entrambe sono risolte) — in parallelo invece che in sequenza.
        const [beforeRow, confirmedKey] = await Promise.all([
          // Incondizionato (non solo quando c'è una foto pending): serve sempre per il diff
          // fase/gruppo usato nell'audit log consolidato sotto, e come `existingRow` per `updateRow`
          // (un solo fetch della riga invece di uno per ogni funzione che ne ha bisogno).
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
          tx as any,
          ctx.session!.user.id
        );

        const sync = quotations !== undefined
          ? await syncRowQuotations(input.rowId, quotations, layoutScope, tx as any)
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

      // Un INSERT indipendente per riga di audit (riga + ciascuna quotazione toccata) — nessuna
      // dipendenza fra loro, un solo Promise.all invece di due giri sequenziali.
      //
      // Insieme a loro lo snapshot automatico del layout: questa transizione può essere quella che
      // completa la fase di un evento per l'intero gruppo di pianificazione. Sta fuori dalla
      // `$transaction` sopra perché `createRevision` apre una transaction propria, non annidabile in
      // quella del salvataggio, e non condivide dati con gli audit — quindi le sue query girano
      // sovrapposte a loro invece di allungare la mutation in serie. Non lancia mai (vedi il
      // service): una revisione fallita non deve far fallire il salvataggio.
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
   * Marca la riga come conclusa (o la riapre). Stato esplicito, non deducibile dal calendario:
   * una riga ferma sull'ultima fase l'ha *raggiunta*, non completata — vedi
   * `getActivePhaseFromEvents`. Da conclusa la riga esce dal countdown di fase e mostra l'esito
   * congelato (`completionOutcome`), e lo scheduler smette di notificarne il ritardo.
   *
   * Riaprire azzera `completedAt`; un cambio fase non lo tocca mai (scelta esplicita: riaprire è
   * un'azione dichiarata, non un effetto collaterale di uno spostamento fatto per sbaglio).
   *
   * Motivazione obbligatoria in entrambi i versi: la conclusione è l'unico momento in cui l'esito
   * viene fissato, e senza un perché l'audit log direbbe solo che è successo.
   *
   * Se la riga non ha attraversato tutte le fasi pianificate serve `force: true` — l'elenco è
   * ricalcolato qui, mai accettato dal client. Non è un divieto (basterebbe saltare all'ultima fase
   * per aggirarlo) ma una registrazione: `completionForced` e `skippedPhases` nell'audit rendono
   * distinguibili, a consuntivo, le righe chiuse pulitamente da quelle forzate.
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

      // Solo in conclusione: riaprire non salta nulla, riporta la riga in lavorazione.
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
 */
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
      await assertBrandAccess(ctx, (row as any).collectionLayout.brandId);

      const { collectionLayout, ...rowData } = row as any;
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
      await assertBrandAccess(ctx, (row as any).collectionLayout.brandId);

      const exportUser = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { firstName: true, lastName: true, username: true },
      });
      const fullName = exportUser
        ? [exportUser.firstName, exportUser.lastName].filter(Boolean).join(' ') || exportUser.username
        : ctx.session.user.username;

      const { collectionLayout, ...rowData } = row as any;
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
        include: EXPORT_INCLUDE,
      });
      if (!layout) throw new TRPCError({ code: 'NOT_FOUND', message: 'Layout non trovato' });
      await assertBrandAccess(ctx, layout.brandId);

      let exportLayout = layout;
      if (input.rowIds && input.rowIds.length > 0) {
        const rowIdSet = new Set(input.rowIds);
        exportLayout = {
          ...layout,
          groups: layout.groups
            .map(g => ({ ...g, rows: g.rows.filter(r => rowIdSet.has(r.id)) }))
            .filter(g => g.rows.length > 0),
        };
      }

      const buffer = await buildCollectionLayoutXlsx(exportLayout, ctx.prisma, ctx.logger);
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
    .use(withRateLimit('exportGeneration'))
    .input(z.object({
      collectionLayoutId: z.string().uuid(),
      rowIds: z.array(z.string().uuid()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const layout = await ctx.prisma.collectionLayout.findUnique({
        where: { id: input.collectionLayoutId },
        include: EXPORT_INCLUDE,
      });
      if (!layout) throw new TRPCError({ code: 'NOT_FOUND', message: 'Layout non trovato' });
      await assertBrandAccess(ctx, layout.brandId);

      let exportLayout = layout;
      if (input.rowIds && input.rowIds.length > 0) {
        const rowIdSet = new Set(input.rowIds);
        exportLayout = {
          ...layout,
          groups: layout.groups
            .map(g => ({ ...g, rows: g.rows.filter(r => rowIdSet.has(r.id)) }))
            .filter(g => g.rows.length > 0),
        };
      }

      const exportUser = await ctx.prisma.user.findUnique({
        where: { id: ctx.session.user.id },
        select: { firstName: true, lastName: true, username: true },
      });

      const fullName = exportUser
        ? [exportUser.firstName, exportUser.lastName].filter(Boolean).join(' ') || exportUser.username
        : ctx.session.user.username;

      const buffer = await buildCollectionLayoutPdf(exportLayout, ctx.prisma, fullName, new Date(), ctx.logger);
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
      // Entrambi i brand, non uno solo: sulla sola sorgente permetterebbe di
      // scrivere in un brand non tuo, sulla sola destinazione è esfiltrazione —
      // leggi la collezione di un brand altrui clonandola in uno tuo.
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
