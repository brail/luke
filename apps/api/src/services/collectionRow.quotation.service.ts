/**
 * Quotation service for collection layout rows.
 * Each row can have N quotations, each linked to a pricing parameter set.
 */

import { TRPCError } from '@trpc/server';

import type {
  CollectionRowQuotationInput,
  CollectionRowQuotationUpdate,
} from '@luke/core';

import type {
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
    const paramSet = await prisma.pricingParameterSet.findUnique({
      where: { id: input.pricingParameterSetId },
      select: { brandId: true, seasonId: true },
    });
    const layout = (row as any).collectionLayout as { brandId: string; seasonId: string };
    if (!paramSet || paramSet.brandId !== layout.brandId || paramSet.seasonId !== layout.seasonId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Il set di parametri non appartiene al brand/stagione corrente',
      });
    }
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
    const layout = (quotation.row as any).collectionLayout as { brandId: string; seasonId: string };
    const paramSet = await prisma.pricingParameterSet.findUnique({
      where: { id: input.pricingParameterSetId },
      select: { brandId: true, seasonId: true },
    });
    if (!paramSet || paramSet.brandId !== layout.brandId || paramSet.seasonId !== layout.seasonId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Il set di parametri non appartiene al brand/stagione corrente',
      });
    }
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

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.collectionRowQuotation.update({
        where: { id },
        data: { order: index },
      })
    )
  );
}
