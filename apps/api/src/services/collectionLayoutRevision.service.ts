import {
  CollectionLayoutRevision,
  CollectionGroupRevision,
  CollectionLayoutRowRevision,
  Prisma,
  PrismaClient,
} from '@prisma/client';

import type { CreateRevisionInput } from '@luke/core';

// ─── Return types ─────────────────────────────────────────────────────────────

export type RevisionSummary = Pick<
  CollectionLayoutRevision,
  'id' | 'revisionNumber' | 'revisionTypeValue' | 'cause' | 'milestoneId' | 'notes' | 'createdAt' | 'createdByUserId'
> & {
  createdBy: { id: string; firstName: string; lastName: string; email: string };
  rowCount: number;
};

export type QuotationRevisionData = {
  id: string;
  order: number;
  pricingParameterSetId: string | null;
  pricingParameterSetName: string | null;
  retailPrice: number | null;
  supplierQuotation: number | null;
  notes: string | null;
  sku: number | null;
};

export type RowRevisionData = CollectionLayoutRowRevision & {
  quotationRevisions: QuotationRevisionData[];
};

export type GroupRevisionData = CollectionGroupRevision & {
  rows: RowRevisionData[];
};

export type RevisionDetail = CollectionLayoutRevision & {
  createdBy: { id: string; firstName: string; lastName: string; email: string };
  groups: GroupRevisionData[];
};

export type CollectionLayoutAsOfRevision = {
  revision: RevisionSummary;
  groups: GroupRevisionData[];
};

// ─── createRevision ───────────────────────────────────────────────────────────

export async function createRevision(
  input: CreateRevisionInput,
  userId: string,
  copyPhoto: (sourceKey: string) => Promise<string>,
  prisma: PrismaClient,
): Promise<RevisionDetail> {
  // Load layout with all relations before entering transaction
  const layout = await prisma.collectionLayout.findUniqueOrThrow({
    where: { id: input.collectionLayoutId },
    include: {
      groups: {
        include: {
          rows: {
            include: {
              vendor: { select: { id: true, name: true, nickname: true } },
              quotations: {
                include: { pricingParameterSet: { select: { id: true, name: true } } },
                orderBy: { order: 'asc' },
              },
            },
            orderBy: { order: 'asc' },
          },
        },
        orderBy: { order: 'asc' },
      },
    },
  });

  // Gather all rows indexed by id for quick lookup
  const allRowsById = new Map(
    layout.groups.flatMap(g => g.rows).map(r => [r.id, r]),
  );

  // Pre-copy photos OUTSIDE the transaction — orphan files if tx fails are acceptable
  // (CAS via sha256 dedup ensures no data loss, only unreferenced bytes in the bucket)
  const rowsWithPhotos = input.includedRowIds
    .map(id => allRowsById.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r?.pictureKey);

  const photoCopyEntries = await Promise.all(
    rowsWithPhotos.map(async r => [r.id, await copyPhoto(r.pictureKey!)] as const),
  );
  const photoCopyMap = new Map(photoCopyEntries);

  return prisma.$transaction(async tx => {
    // Next revision number (0-indexed)
    const aggregate = await tx.collectionLayoutRevision.aggregate({
      where: { collectionLayoutId: input.collectionLayoutId },
      _max: { revisionNumber: true },
    });
    const nextRevisionNumber = (aggregate._max.revisionNumber ?? -1) + 1;

    // Create revision header
    const revision = await tx.collectionLayoutRevision.create({
      data: {
        collectionLayoutId: input.collectionLayoutId,
        revisionNumber: nextRevisionNumber,
        revisionTypeValue: input.revisionTypeValue,
        cause: input.cause,
        milestoneId: input.milestoneId ?? null,
        notes: input.notes ?? null,
        createdByUserId: userId,
      },
    });

    // Snapshot each live group
    const groupRevisionMap = new Map<string, string>(); // sourceGroupId → groupRevisionId
    for (const group of layout.groups) {
      const groupRev = await tx.collectionGroupRevision.create({
        data: {
          revisionId: revision.id,
          sourceGroupId: group.id,
          name: group.name,
          order: group.order,
          skuBudget: group.skuBudget,
        },
      });
      groupRevisionMap.set(group.id, groupRev.id);
    }

    // Snapshot included rows
    const includedRowIdSet = new Set(input.includedRowIds);
    for (const rowId of input.includedRowIds) {
      const row = allRowsById.get(rowId);
      if (!row) continue;

      const sourceGroupRevisionId = groupRevisionMap.get(row.groupId);
      if (!sourceGroupRevisionId) continue;

      const rowRev = await tx.collectionLayoutRowRevision.create({
        data: {
          revisionId: revision.id,
          sourceGroupRevisionId,
          sourceRowId: rowId,
          wasDeleted: false,
          gender: row.gender,
          vendorId: row.vendorId,
          vendorName: row.vendor?.nickname ?? row.vendor?.name ?? null,
          line: row.line,
          article: row.article,
          status: row.status,
          skuForecast: row.skuForecast,
          qtyForecast: row.qtyForecast,
          productCategory: row.productCategory,
          strategy: row.strategy,
          styleStatus: row.styleStatus,
          progress: row.progress,
          designer: row.designer,
          pictureKey: photoCopyMap.get(rowId) ?? null,
          styleNotes: row.styleNotes,
          materialNotes: row.materialNotes,
          colorNotes: row.colorNotes,
          toolingNotes: row.toolingNotes,
          toolingQuotation: row.toolingQuotation,
          order: row.order,
        },
      });

      // Snapshot quotations
      for (const quotation of row.quotations) {
        await tx.collectionRowQuotationRevision.create({
          data: {
            rowRevisionId: rowRev.id,
            order: quotation.order,
            pricingParameterSetId: quotation.pricingParameterSetId,
            pricingParameterSetName: quotation.pricingParameterSet?.name ?? null,
            retailPrice: quotation.retailPrice,
            supplierQuotation: quotation.supplierQuotation,
            notes: quotation.notes,
            sku: quotation.sku,
          },
        });
      }

      // Mark row as revised
      await tx.collectionLayoutRow.update({
        where: { id: rowId },
        data: { lastRevisedAt: new Date() },
      });
    }

    // Return full revision detail
    return tx.collectionLayoutRevision.findUniqueOrThrow({
      where: { id: revision.id },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        groups: {
          include: {
            rows: {
              where: { sourceRowId: { in: [...includedRowIdSet] } },
              include: { quotationRevisions: true },
              orderBy: { order: 'asc' },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });
  }, { timeout: 30_000 }) as unknown as RevisionDetail;
}

// ─── listRevisions ────────────────────────────────────────────────────────────

export async function listRevisions(
  collectionLayoutId: string,
  prisma: PrismaClient,
): Promise<RevisionSummary[]> {
  const revisions = await prisma.collectionLayoutRevision.findMany({
    where: { collectionLayoutId },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      rowRevisions: { select: { id: true } },
    },
    orderBy: { revisionNumber: 'desc' },
  });

  return revisions.map(r => ({
    id: r.id,
    revisionNumber: r.revisionNumber,
    revisionTypeValue: r.revisionTypeValue,
    cause: r.cause,
    milestoneId: r.milestoneId,
    notes: r.notes,
    createdAt: r.createdAt,
    createdByUserId: r.createdByUserId,
    createdBy: r.createdBy,
    rowCount: r.rowRevisions.length,
  }));
}

// ─── getRevisionDetail ────────────────────────────────────────────────────────

export async function getRevisionDetail(
  revisionId: string,
  prisma: PrismaClient,
): Promise<RevisionDetail> {
  return prisma.collectionLayoutRevision.findUniqueOrThrow({
    where: { id: revisionId },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      groups: {
        include: {
          rows: {
            include: { quotationRevisions: { orderBy: { order: 'asc' } } },
            orderBy: { order: 'asc' },
          },
        },
        orderBy: { order: 'asc' },
      },
    },
  }) as unknown as Promise<RevisionDetail>;
}

// ─── getLayoutAsOfRevision ────────────────────────────────────────────────────

export async function getLayoutAsOfRevision(
  collectionLayoutId: string,
  revisionId: string,
  prisma: PrismaClient,
): Promise<CollectionLayoutAsOfRevision> {
  // Resolve target revision number
  const targetRevision = await prisma.collectionLayoutRevision.findUniqueOrThrow({
    where: { id: revisionId },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
      rowRevisions: { select: { id: true } },
    },
  });

  // Backward lookup: for each sourceRowId, find the most recent revision ≤ target
  // Uses DISTINCT ON for efficient "latest-per-group" query
  const rowRevisions = await prisma.$queryRaw<(CollectionLayoutRowRevision & { quotations_json: string })[]>(
    Prisma.sql`
      SELECT DISTINCT ON (rr."sourceRowId")
        rr.*,
        COALESCE(
          json_agg(q.* ORDER BY q.order) FILTER (WHERE q.id IS NOT NULL),
          '[]'::json
        )::text AS quotations_json
      FROM collection_layout_row_revisions rr
      JOIN collection_layout_revisions r ON rr."revisionId" = r.id
      LEFT JOIN collection_row_quotation_revisions q ON q."rowRevisionId" = rr.id
      WHERE r."collectionLayoutId" = ${collectionLayoutId}
        AND r."revisionNumber" <= ${targetRevision.revisionNumber}
      GROUP BY rr.id, r."revisionNumber"
      ORDER BY rr."sourceRowId", r."revisionNumber" DESC
    `,
  );

  // Filter out rows that were deleted at the latest snapshot
  const liveRowRevisions = rowRevisions.filter(r => !r.wasDeleted);

  // Hydrate quotationRevisions from json
  const hydratedRows: RowRevisionData[] = liveRowRevisions.map(r => ({
    ...r,
    quotationRevisions: JSON.parse((r as unknown as { quotations_json: string }).quotations_json) as QuotationRevisionData[],
  }));

  // Fetch group revisions for the target revision (as structural scaffold)
  const groups = await prisma.collectionGroupRevision.findMany({
    where: { revisionId },
    orderBy: { order: 'asc' },
  });

  // Build sourceGroupId lookup from already-fetched groups (avoids N+1)
  const gRevSourceGroupId = new Map(groups.map(g => [g.id, g.sourceGroupId]));

  const rowsByGroupId = new Map<string, RowRevisionData[]>();
  for (const row of hydratedRows) {
    const key = gRevSourceGroupId.get(row.sourceGroupRevisionId) ?? row.sourceGroupRevisionId;
    if (!rowsByGroupId.has(key)) rowsByGroupId.set(key, []);
    rowsByGroupId.get(key)!.push(row);
  }

  const groupsWithRows: GroupRevisionData[] = groups.map(g => ({
    ...g,
    rows: rowsByGroupId.get(g.sourceGroupId) ?? [],
  }));

  return {
    revision: {
      id: targetRevision.id,
      revisionNumber: targetRevision.revisionNumber,
      revisionTypeValue: targetRevision.revisionTypeValue,
      cause: targetRevision.cause,
      milestoneId: targetRevision.milestoneId,
      notes: targetRevision.notes,
      createdAt: targetRevision.createdAt,
      createdByUserId: targetRevision.createdByUserId,
      createdBy: targetRevision.createdBy,
      rowCount: targetRevision.rowRevisions.length,
    },
    groups: groupsWithRows,
  };
}
