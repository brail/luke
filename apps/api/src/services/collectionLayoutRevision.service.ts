import { StorageObjectNotFoundError } from '@luke/core';
import type { CreateRevisionInput } from '@luke/core';
import {
  CollectionLayoutRevision,
  CollectionGroupRevision,
  CollectionLayoutRowRevision,
  Prisma,
  PrismaClient,
} from '@luke/db';

import { imageFetchLimiter } from '../lib/export/concurrency.js';

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

/**
 * Snapshots the current collection layout as a new revision. Photos are copied to the
 * immutable bucket before the transaction to keep the transaction short.
 *
 * A row whose photo object is gone from live storage is snapshotted without a photo and reported
 * in `missingPhotoRowIds`, for the caller to record: the row cannot be copied as it was loaded,
 * and failing the whole revision over it would block every later one too — provided the storage
 * served at least one other photo of the layout. Otherwise, and on any other copy failure, the
 * revision fails, so it is retried rather than recorded short.
 *
 * @param copyPhoto - Callback that copies a photo by source key and returns the new key; it throws
 *   `StorageObjectNotFoundError` when the source is gone.
 * @returns The created revision with all groups, rows, and quotation snapshots, and the rows whose
 *   photo was gone.
 */
export async function createRevision(
  input: CreateRevisionInput,
  userId: string,
  copyPhoto: (sourceKey: string) => Promise<string>,
  prisma: PrismaClient,
): Promise<{ revision: RevisionDetail; missingPhotoRowIds: string[] }> {
  // Load layout with all relations before entering transaction
  const layout = await prisma.collectionLayout.findUniqueOrThrow({
    where: { id: input.collectionLayoutId },
    include: {
      groups: {
        include: {
          rows: {
            include: {
              vendor: { select: { id: true, name: true, nickname: true } },
              phase: { select: { value: true } },
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

  const allRows = layout.groups.flatMap(g => g.rows);

  // Pre-copy photos OUTSIDE the transaction — orphan files if tx fails are acceptable
  // (CAS via sha256 dedup ensures no data loss, only unreferenced bytes in the bucket).
  // A bounded number at a time: each copy holds its photo in memory.
  const rowsWithPhotos = allRows.filter(r => !!r.pictureKey);
  const photoCopyMap = new Map<string, string>();
  const limit = imageFetchLimiter();
  await Promise.all(
    rowsWithPhotos.map(r => limit(async () => {
      try {
        photoCopyMap.set(r.id, await copyPhoto(r.pictureKey!));
      } catch (err) {
        if (err instanceof StorageObjectNotFoundError) return;
        limit.clearQueue(); // the revision fails: start no further copies
        throw err;
      }
    })),
  );
  const missingPhotoRowIds = rowsWithPhotos.filter(r => !photoCopyMap.has(r.id)).map(r => r.id);
  // Absence is believed only from a storage that served at least one photo of this layout: one
  // that serves none is more likely looking in the wrong place (an empty volume, a new bucket) than
  // to have lost every photo, and a revision recorded then would stay without them for good.
  if (missingPhotoRowIds.length > 0 && photoCopyMap.size === 0) {
    throw new Error(
      `No photo of layout ${input.collectionLayoutId} could be read from storage (${missingPhotoRowIds.length} rows); not recording a revision without them`,
    );
  }

  const detail = await prisma.$transaction(async tx => {
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

    // Snapshot every row in the layout — revisions always cover the full layout
    for (const row of allRows) {
      const sourceGroupRevisionId = groupRevisionMap.get(row.groupId);
      if (!sourceGroupRevisionId) continue;

      const rowRev = await tx.collectionLayoutRowRevision.create({
        data: {
          revisionId: revision.id,
          sourceGroupRevisionId,
          sourceRowId: row.id,
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
          progress: row.phase?.value ?? null,
          designer: row.designer,
          pictureKey: photoCopyMap.get(row.id) ?? null,
          styleNotes: row.styleNotes,
          materialNotes: row.materialNotes,
          colorNotes: row.colorNotes,
          toolingNotes: row.toolingNotes,
          toolingQuotation: row.toolingQuotation,
          pricePositioning: row.pricePositioning,
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
    }

    // Mark rows as revised, in one statement: a row deleted since the layout was loaded is skipped.
    await tx.collectionLayoutRow.updateMany({
      where: { id: { in: allRows.map(r => r.id) } },
      data: { lastRevisedAt: new Date() },
    });

    // Return full revision detail
    return tx.collectionLayoutRevision.findUniqueOrThrow({
      where: { id: revision.id },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
        groups: {
          include: {
            rows: {
              include: { quotationRevisions: true },
              orderBy: { order: 'asc' },
            },
          },
          orderBy: { order: 'asc' },
        },
      },
    });
  }, { timeout: 30_000 }) as unknown as RevisionDetail;

  return { revision: detail, missingPhotoRowIds };
}

// ─── listRevisions ────────────────────────────────────────────────────────────

/**
 * Lists all revisions for a collection layout in descending revision number order.
 *
 * @returns Lightweight revision summaries including row count and creator info.
 */
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

/**
 * Fetches a single revision with its full group/row/quotation snapshot.
 *
 * @throws Prisma NotFoundError if the revision does not exist.
 */
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

/**
 * Reconstructs the layout state as it appeared at a specific revision by applying a
 * "latest snapshot ≤ target revision number" strategy via raw SQL. Deleted rows are excluded.
 *
 * @returns The target revision summary plus the reconstructed group/row structure.
 */
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

  // Backward lookup: for each sourceRowId, find the most recent revision ≤ target.
  // JOIN on collection_group_revisions to carry sourceGroupId directly — rows from
  // earlier revisions have a sourceGroupRevisionId that belongs to a different revision,
  // so we cannot look it up from the target revision's group map alone.
  // Raw SQL exemption (CLAUDE.md Stack Constraints): DISTINCT ON + json_agg(...) FILTER
  // has no Prisma ORM equivalent. Uses the safe Prisma.sql tagged template (parameterized),
  // never $queryRawUnsafe.
  const rowRevisions = await prisma.$queryRaw<(CollectionLayoutRowRevision & { source_group_id: string; quotations_json: string })[]>(
    Prisma.sql`
      SELECT DISTINCT ON (rr."sourceRowId")
        rr.*,
        grv."sourceGroupId" AS source_group_id,
        COALESCE(
          json_agg(q.* ORDER BY q.order) FILTER (WHERE q.id IS NOT NULL),
          '[]'::json
        )::text AS quotations_json
      FROM collection_layout_row_revisions rr
      JOIN collection_layout_revisions r ON rr."revisionId" = r.id
      JOIN collection_group_revisions grv ON rr."sourceGroupRevisionId" = grv.id
      LEFT JOIN collection_row_quotation_revisions q ON q."rowRevisionId" = rr.id
      WHERE r."collectionLayoutId" = ${collectionLayoutId}
        AND r."revisionNumber" <= ${targetRevision.revisionNumber}
      GROUP BY rr.id, r."revisionNumber", grv."sourceGroupId"
      ORDER BY rr."sourceRowId", r."revisionNumber" DESC
    `,
  );

  // Filter out rows that were deleted at the latest snapshot
  const liveRowRevisions = rowRevisions.filter(r => !r.wasDeleted);

  // Hydrate quotationRevisions from json
  const hydratedRows: (RowRevisionData & { source_group_id: string })[] = liveRowRevisions.map(r => ({
    ...r,
    quotationRevisions: JSON.parse((r as unknown as { quotations_json: string }).quotations_json) as QuotationRevisionData[],
  }));

  // Fetch group revisions for the target revision (as structural scaffold)
  const groups = await prisma.collectionGroupRevision.findMany({
    where: { revisionId },
    orderBy: { order: 'asc' },
  });

  // Bucket rows by sourceGroupId — available directly from the JOIN, works across revisions
  const rowsBySourceGroupId = new Map<string, RowRevisionData[]>();
  for (const row of hydratedRows) {
    const key = row.source_group_id;
    if (!rowsBySourceGroupId.has(key)) rowsBySourceGroupId.set(key, []);
    rowsBySourceGroupId.get(key)!.push(row);
  }

  const groupsWithRows: GroupRevisionData[] = groups.map(g => ({
    ...g,
    rows: rowsBySourceGroupId.get(g.sourceGroupId) ?? [],
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
