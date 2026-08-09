/**
 * Quotation service for collection layout rows.
 * Each row can have N quotations, each linked to a pricing parameter set.
 */

import { TRPCError } from '@trpc/server';

import type {
  CollectionRowQuotationDraft,
  CollectionRowQuotationInput,
  CollectionRowQuotationUpdate,
} from '@luke/core';

import type {
  Prisma,
  PrismaClient,
  CollectionRowQuotation,
  PricingParameterSet,
} from '@prisma/client';

export type QuotationWithParamSet = CollectionRowQuotation & {
  pricingParameterSet: PricingParameterSet | null;
};

const QUOTATION_INCLUDE = {
  pricingParameterSet: true,
} as const;

/**
 * Ensures every referenced pricing parameter set belongs to the row's brand+season — shared by
 * `createQuotation`, `updateQuotation`, and `syncRowQuotations`, which all enforce the same rule.
 * No-op if `paramSetIds` is empty.
 *
 * @throws {TRPCError} BAD_REQUEST if any id doesn't belong to `layout`'s brand/season (including a
 *   non-existent id).
 */
async function assertParamSetsInScope(
  paramSetIds: string[],
  layout: { brandId: string; seasonId: string },
  prisma: PrismaClient | Prisma.TransactionClient
): Promise<void> {
  if (paramSetIds.length === 0) return;
  const paramSets = await prisma.pricingParameterSet.findMany({
    where: { id: { in: paramSetIds } },
    select: { id: true, brandId: true, seasonId: true },
  });
  const validIds = new Set(
    paramSets.filter(ps => ps.brandId === layout.brandId && ps.seasonId === layout.seasonId).map(ps => ps.id)
  );
  if (paramSetIds.some(id => !validIds.has(id))) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Il set di parametri non appartiene al brand/stagione corrente',
    });
  }
}

/**
 * Creates a new quotation on a collection row. Validates that the referenced pricing
 * parameter set belongs to the same brand+season as the row's layout.
 *
 * @throws {TRPCError} NOT_FOUND if the row does not exist.
 * @throws {TRPCError} BAD_REQUEST if the parameter set belongs to a different brand or season.
 */
export async function createQuotation(
  input: CollectionRowQuotationInput,
  prisma: PrismaClient
): Promise<QuotationWithParamSet> {
  const row = await prisma.collectionLayoutRow.findUnique({
    where: { id: input.rowId },
    include: { collectionLayout: { select: { brandId: true, seasonId: true } } },
  });

  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Riga non trovata' });
  }

  if (input.pricingParameterSetId) {
    const layout = row.collectionLayout;
    await assertParamSetsInScope([input.pricingParameterSetId], layout, prisma);
  }

  const existingCount = await prisma.collectionRowQuotation.count({
    where: { rowId: input.rowId },
  });

  return prisma.collectionRowQuotation.create({
    data: {
      rowId: input.rowId,
      order: input.order ?? existingCount,
      pricingParameterSetId: input.pricingParameterSetId ?? null,
      retailPrice: input.retailPrice ?? null,
      supplierQuotation: input.supplierQuotation ?? null,
      notes: input.notes ?? null,
      sku: input.sku ?? null,
    },
    include: QUOTATION_INCLUDE,
  }) as Promise<QuotationWithParamSet>;
}

/**
 * Updates fields on an existing quotation. Validates the pricing parameter set if changed.
 *
 * @throws {TRPCError} NOT_FOUND if the quotation does not exist.
 * @throws {TRPCError} BAD_REQUEST if the new parameter set belongs to a different brand or season.
 */
export async function updateQuotation(
  quotationId: string,
  input: CollectionRowQuotationUpdate,
  prisma: PrismaClient
): Promise<QuotationWithParamSet> {
  const quotation = await prisma.collectionRowQuotation.findUnique({
    where: { id: quotationId },
    include: { row: { include: { collectionLayout: { select: { brandId: true, seasonId: true } } } } },
  });

  if (!quotation) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Quotazione non trovata' });
  }

  if (input.pricingParameterSetId) {
    const layout = quotation.row.collectionLayout;
    await assertParamSetsInScope([input.pricingParameterSetId], layout, prisma);
  }

  return prisma.collectionRowQuotation.update({
    where: { id: quotationId },
    data: {
      ...(input.order !== undefined && { order: input.order }),
      ...('pricingParameterSetId' in input && { pricingParameterSetId: input.pricingParameterSetId ?? null }),
      ...('retailPrice' in input && { retailPrice: input.retailPrice ?? null }),
      ...('supplierQuotation' in input && { supplierQuotation: input.supplierQuotation ?? null }),
      ...('notes' in input && { notes: input.notes ?? null }),
      ...('sku' in input && { sku: input.sku ?? null }),
    },
    include: QUOTATION_INCLUDE,
  }) as Promise<QuotationWithParamSet>;
}

/**
 * Deletes a quotation from a collection row.
 *
 * @throws {TRPCError} NOT_FOUND if the quotation does not exist.
 */
export async function deleteQuotation(
  quotationId: string,
  prisma: PrismaClient
): Promise<void> {
  const quotation = await prisma.collectionRowQuotation.findUnique({
    where: { id: quotationId },
  });

  if (!quotation) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Quotazione non trovata' });
  }

  await prisma.collectionRowQuotation.delete({ where: { id: quotationId } });
}

/**
 * Reassigns display order for all quotations in a row based on the provided ordered ID list.
 *
 * @param orderedIds - Quotation IDs in the desired display order (0-indexed).
 * @throws {TRPCError} NOT_FOUND if the row does not exist.
 */
export async function reorderQuotations(
  rowId: string,
  orderedIds: string[],
  prisma: PrismaClient
): Promise<void> {
  const row = await prisma.collectionLayoutRow.findUnique({
    where: { id: rowId },
  });

  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Riga non trovata' });
  }

  // `updateMany` with `rowId` in the where, not `update` by id: the previous
  // version reordered whatever id you passed it, so
  // `reorder({ rowId: <mine>, orderedIds: [<someone else's quotation>] })` mutated
  // the foreign record. The brand-scope guard doesn't stop it — `rowId` is legitimate,
  // it's the rest of the list that isn't.
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.collectionRowQuotation.updateMany({
        where: { id, rowId },
        data: { order: index },
      })
    )
  );
}

/** Result of `syncRowQuotations` — the router needs the actual touched records/ids (not just
 * counts) to log one audit entry per quotation, same as the standalone create/update/delete
 * endpoints did before the row-drawer's buffered-save refactor. */
export interface QuotationSyncResult {
  created: QuotationWithParamSet[];
  updated: QuotationWithParamSet[];
  deletedIds: string[];
}

/**
 * Reconciles a row's quotations against a client-submitted desired list, in one pass: any DB
 * quotation whose id isn't in `drafts` is deleted, any draft without an `id` is created, any draft
 * with an `id` matching an existing quotation is updated. Used by the row drawer's buffered save
 * (`rowsRouter.create`/`update`) instead of the standalone `quotations.create/update/delete`
 * mutations, which committed on every blur/click regardless of whether the row itself was saved.
 *
 * No internal `$transaction` — the caller already holds one open (row create/update transaction)
 * and passes its `tx` here; opening a nested transaction isn't supported/needed.
 *
 * @param layoutScope - Brand/season of the row's layout, resolved by the caller (already needed
 *   there for the brand-access guard) instead of a redundant row `findUnique` here.
 * @throws {TRPCError} BAD_REQUEST if a draft's `id` doesn't belong to this row (stale/foreign id —
 *   silently treating it as "new" would orphan the original and create a duplicate instead of
 *   surfacing the conflict), or if a `pricingParameterSetId` doesn't belong to the row's brand/season.
 */
export async function syncRowQuotations(
  rowId: string,
  drafts: CollectionRowQuotationDraft[],
  layoutScope: { brandId: string; seasonId: string },
  prisma: PrismaClient | Prisma.TransactionClient
): Promise<QuotationSyncResult> {
  const existing = await prisma.collectionRowQuotation.findMany({
    where: { rowId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map(e => e.id));

  for (const draft of drafts) {
    if (draft.id && !existingIds.has(draft.id)) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Quotazione non trovata per questa riga' });
    }
  }

  const paramSetIds = [...new Set(drafts.map(d => d.pricingParameterSetId).filter((id): id is string => !!id))];
  await assertParamSetsInScope(paramSetIds, layoutScope, prisma);

  const submittedIds = new Set(drafts.filter(d => d.id).map(d => d.id!));
  const deletedIds = [...existingIds].filter(id => !submittedIds.has(id));

  // deleteMany and the per-draft writes touch disjoint sets of rows (`deletedIds` is the complement
  // of `submittedIds`) — run in parallel instead of in sequence, same principle already applied to
  // the locks in editLock.service.ts (Promise.all on tx).
  const [, writes] = await Promise.all([
    deletedIds.length > 0
      ? prisma.collectionRowQuotation.deleteMany({ where: { id: { in: deletedIds }, rowId } })
      : Promise.resolve(undefined),
    Promise.all(
      drafts.map(async (draft, index) => {
        const data = {
          order: index,
          pricingParameterSetId: draft.pricingParameterSetId ?? null,
          retailPrice: draft.retailPrice ?? null,
          supplierQuotation: draft.supplierQuotation ?? null,
          notes: draft.notes ?? null,
          sku: draft.sku ?? null,
        };
        return draft.id
          ? { kind: 'updated' as const, quotation: (await prisma.collectionRowQuotation.update({
              where: { id: draft.id },
              data,
              include: QUOTATION_INCLUDE,
            })) as QuotationWithParamSet }
          : { kind: 'created' as const, quotation: (await prisma.collectionRowQuotation.create({
              data: { rowId, ...data },
              include: QUOTATION_INCLUDE,
            })) as QuotationWithParamSet };
      })
    ),
  ]);

  return {
    created: writes.filter(w => w.kind === 'created').map(w => w.quotation),
    updated: writes.filter(w => w.kind === 'updated').map(w => w.quotation),
    deletedIds,
  };
}
