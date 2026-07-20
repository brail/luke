
import { buildCollectionLayoutPdf } from './collectionLayout.export.pdf.service';
import { buildCollectionLayoutXlsx } from './collectionLayout.export.xlsx.service';
import { getLayoutAsOfRevision } from './collectionLayoutRevision.service';

import type { CollectionLayoutForPdf } from './collectionLayout.export.pdf.service';
import type { CollectionLayoutForExport } from './collectionLayout.export.xlsx.service';
import type { QuotationWithParamSet } from './collectionLayout.service';
import type { PrismaClient } from '@prisma/client';

type Logger = { warn: (obj: object, msg: string) => void };

// ─── Mapper ───────────────────────────────────────────────────────────────────

async function buildRevisionExportLayout(
  revisionId: string,
  collectionLayoutId: string,
  prisma: PrismaClient,
): Promise<CollectionLayoutForExport> {
  const [snapshotResult, layoutMeta] = await Promise.all([
    getLayoutAsOfRevision(collectionLayoutId, revisionId, prisma),
    prisma.collectionLayout.findUniqueOrThrow({
      where: { id: collectionLayoutId },
      include: {
        brand:  { select: { name: true, code: true, logoKey: true } },
        season: { select: { name: true, code: true, year: true } },
      },
    }),
  ]);

  // Collect all unique pricingParameterSet IDs referenced in quotation revisions
  const psIds = new Set<string>();
  for (const g of snapshotResult.groups) {
    for (const r of g.rows) {
      for (const q of r.quotationRevisions) {
        if (q.pricingParameterSetId) psIds.add(q.pricingParameterSetId);
      }
    }
  }

  const parameterSets = psIds.size > 0
    ? await prisma.pricingParameterSet.findMany({ where: { id: { in: [...psIds] } } })
    : [];
  const psMap = new Map(parameterSets.map(ps => [ps.id, ps]));

  const groups = snapshotResult.groups.map(g => ({
    ...g,
    collectionLayoutId,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    rows: g.rows
      .filter(r => !r.wasDeleted)
      .map(r => ({
        ...r,
        groupId: g.id,
        collectionLayoutId,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        vendor: r.vendorId
          ? { id: r.vendorId, name: r.vendorName ?? '', nickname: null }
          : null,
        quotations: r.quotationRevisions.map(q => {
          const quotation: QuotationWithParamSet = {
            id: q.id,
            order: q.order,
            rowId: r.id,
            pricingParameterSetId: q.pricingParameterSetId,
            retailPrice: q.retailPrice,
            supplierQuotation: q.supplierQuotation,
            notes: q.notes,
            sku: q.sku,
            createdAt: new Date(),
            updatedAt: new Date(),
            pricingParameterSet: q.pricingParameterSetId ? (psMap.get(q.pricingParameterSetId) ?? null) : null,
          };
          return quotation;
        }),
      })),
  }));

  return {
    ...layoutMeta,
    groups,
  } as unknown as CollectionLayoutForExport;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Builds an XLSX export of a collection layout as it existed at a specific revision snapshot.
 * Row photos are read from the revisions picture bucket.
 *
 * @returns A Buffer containing the XLSX file.
 */
export async function buildRevisionXlsx(
  revisionId: string,
  collectionLayoutId: string,
  prisma: PrismaClient,
  logger?: Logger,
): Promise<Buffer> {
  const layout = await buildRevisionExportLayout(revisionId, collectionLayoutId, prisma);
  return buildCollectionLayoutXlsx(layout, prisma, logger, 'collection-row-pictures-revisions');
}

/**
 * Builds a PDF export of a collection layout as it existed at a specific revision snapshot.
 * Row photos are read from the revisions picture bucket.
 *
 * @param extractedBy - Display name of the requesting user (shown in the page header).
 * @returns A Buffer containing the PDF file.
 */
export async function buildRevisionPdf(
  revisionId: string,
  collectionLayoutId: string,
  extractedBy: string,
  prisma: PrismaClient,
  logger?: Logger,
): Promise<Buffer> {
  const layout = await buildRevisionExportLayout(revisionId, collectionLayoutId, prisma) as unknown as CollectionLayoutForPdf;
  return buildCollectionLayoutPdf(layout, prisma, extractedBy, new Date(), logger, 'collection-row-pictures-revisions');
}
