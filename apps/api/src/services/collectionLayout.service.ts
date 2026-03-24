/**
 * Collection Layout Service — Gestione Collection Layout per brand+stagione
 *
 * Funzioni pure esportate, prisma sempre ultimo argomento.
 * Errori: TRPCError con codici NOT_FOUND, CONFLICT, BAD_REQUEST.
 */

import { TRPCError } from '@trpc/server';

import type {
  CollectionGroupInput,
  CollectionLayoutRowInput,
} from '@luke/core';

import type {
  PrismaClient,
  CollectionLayout,
  CollectionGroup,
  CollectionLayoutRow,
  Vendor,
} from '@prisma/client';

// ─────────────────────────────────────────────────────────────────
// Tipo di ritorno arricchito
// ─────────────────────────────────────────────────────────────────

export type RowWithVendor = CollectionLayoutRow & {
  vendor: Pick<Vendor, 'id' | 'name' | 'nickname'> | null;
};

export type CollectionLayoutWithRelations = CollectionLayout & {
  groups: (CollectionGroup & {
    rows: RowWithVendor[];
  })[];
  rows: RowWithVendor[];
};

// ─────────────────────────────────────────────────────────────────
// Include clause comune
// ─────────────────────────────────────────────────────────────────

const ROW_VENDOR_INCLUDE = {
  vendor: { select: { id: true, name: true, nickname: true } },
} as const;

const LAYOUT_INCLUDE = {
  groups: {
    orderBy: { order: 'asc' as const },
    include: {
      rows: {
        orderBy: { order: 'asc' as const },
        include: ROW_VENDOR_INCLUDE,
      },
    },
  },
  rows: {
    orderBy: { order: 'asc' as const },
    include: ROW_VENDOR_INCLUDE,
  },
} as const;

// ─────────────────────────────────────────────────────────────────
// Collection Layout
// ─────────────────────────────────────────────────────────────────

export async function getLayout(
  brandId: string,
  seasonId: string,
  prisma: PrismaClient
): Promise<CollectionLayoutWithRelations | null> {
  return prisma.collectionLayout.findUnique({
    where: { brandId_seasonId: { brandId, seasonId } },
    include: LAYOUT_INCLUDE,
  });
}

export async function getOrCreateLayout(
  brandId: string,
  seasonId: string,
  prisma: PrismaClient
): Promise<CollectionLayoutWithRelations> {
  const existing = await prisma.collectionLayout.findUnique({
    where: { brandId_seasonId: { brandId, seasonId } },
    include: LAYOUT_INCLUDE,
  });

  if (existing) return existing;

  return prisma.collectionLayout.create({
    data: { brandId, seasonId },
    include: LAYOUT_INCLUDE,
  });
}

export async function copyFromSeason(
  fromBrandId: string,
  fromSeasonId: string,
  toBrandId: string,
  toSeasonId: string,
  prisma: PrismaClient
): Promise<CollectionLayoutWithRelations> {
  const source = await prisma.collectionLayout.findUnique({
    where: { brandId_seasonId: { brandId: fromBrandId, seasonId: fromSeasonId } },
    include: LAYOUT_INCLUDE,
  });

  if (!source) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Collection layout di partenza non trovato',
    });
  }

  const existing = await prisma.collectionLayout.findUnique({
    where: { brandId_seasonId: { brandId: toBrandId, seasonId: toSeasonId } },
  });

  if (existing) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Esiste già un collection layout per questo brand/stagione',
    });
  }

  return prisma.$transaction(async tx => {
    const newLayout = await tx.collectionLayout.create({
      data: { brandId: toBrandId, seasonId: toSeasonId },
    });

    for (const group of source.groups) {
      const newGroup = await tx.collectionGroup.create({
        data: {
          collectionLayoutId: newLayout.id,
          name: group.name,
          order: group.order,
        },
      });

      for (const row of group.rows) {
        const { id: _id, collectionLayoutId: _cid, groupId: _gid, createdAt: _ca, updatedAt: _ua, pictureUrl: _pic, vendor: _vendor, ...rowData } = row;
        await tx.collectionLayoutRow.create({
          data: {
            ...rowData,
            collectionLayoutId: newLayout.id,
            groupId: newGroup.id,
            pictureUrl: null, // image non copiata intenzionalmente
          },
        });
      }
    }

    return tx.collectionLayout.findUniqueOrThrow({
      where: { id: newLayout.id },
      include: LAYOUT_INCLUDE,
    });
  });
}

// ─────────────────────────────────────────────────────────────────
// Collection Groups
// ─────────────────────────────────────────────────────────────────

export async function createGroup(
  collectionLayoutId: string,
  input: CollectionGroupInput,
  prisma: PrismaClient
): Promise<CollectionGroup> {
  const layout = await prisma.collectionLayout.findUnique({
    where: { id: collectionLayoutId },
  });

  if (!layout) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Collection layout non trovato',
    });
  }

  const existingCount = await prisma.collectionGroup.count({
    where: { collectionLayoutId },
  });

  return prisma.collectionGroup.create({
    data: {
      collectionLayoutId,
      name: input.name,
      order: input.order ?? existingCount,
      skuBudget: input.skuBudget ?? null,
    },
  });
}

export async function updateGroup(
  groupId: string,
  input: Partial<CollectionGroupInput>,
  prisma: PrismaClient
): Promise<CollectionGroup> {
  const group = await prisma.collectionGroup.findUnique({
    where: { id: groupId },
  });

  if (!group) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Gruppo non trovato',
    });
  }

  return prisma.collectionGroup.update({
    where: { id: groupId },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.order !== undefined && { order: input.order }),
      ...('skuBudget' in input && { skuBudget: input.skuBudget }),
    },
  });
}

export async function deleteGroup(
  groupId: string,
  prisma: PrismaClient
): Promise<void> {
  const group = await prisma.collectionGroup.findUnique({
    where: { id: groupId },
  });

  if (!group) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Gruppo non trovato',
    });
  }

  await prisma.collectionGroup.delete({ where: { id: groupId } });
}

// ─────────────────────────────────────────────────────────────────
// Collection Layout Rows
// ─────────────────────────────────────────────────────────────────

export async function createRow(
  input: CollectionLayoutRowInput,
  prisma: PrismaClient
): Promise<CollectionLayoutRow> {
  const group = await prisma.collectionGroup.findUnique({
    where: { id: input.groupId },
  });

  if (!group) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Gruppo non trovato',
    });
  }

  const existingCount = await prisma.collectionLayoutRow.count({
    where: { groupId: input.groupId },
  });

  const { order, ...rowData } = input;

  return prisma.collectionLayoutRow.create({
    data: {
      ...rowData,
      collectionLayoutId: group.collectionLayoutId,
      order: order ?? existingCount,
      vendorId: rowData.vendorId ?? null,
      strategy: rowData.strategy ?? null,
      styleStatus: rowData.styleStatus ?? null,
      progress: rowData.progress ?? null,
      designer: rowData.designer ?? null,
      pictureUrl: rowData.pictureUrl ?? null,
      styleNotes: rowData.styleNotes ?? null,
      materialNotes: rowData.materialNotes ?? null,
      colorNotes: rowData.colorNotes ?? null,
      priceNotes: rowData.priceNotes ?? null,
      toolingNotes: rowData.toolingNotes ?? null,
      pricingParameterSetId: rowData.pricingParameterSetId ?? null,
      retailTargetPrice: rowData.retailTargetPrice ?? null,
      buyingTargetPrice: rowData.buyingTargetPrice ?? null,
      supplierFirstQuotation: rowData.supplierFirstQuotation ?? null,
      toolingQuotation: rowData.toolingQuotation ?? null,
    },
    include: ROW_VENDOR_INCLUDE,
  });
}

export async function updateRow(
  rowId: string,
  input: Partial<CollectionLayoutRowInput>,
  prisma: PrismaClient
): Promise<CollectionLayoutRow> {
  const row = await prisma.collectionLayoutRow.findUnique({
    where: { id: rowId },
  });

  if (!row) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Riga non trovata',
    });
  }

  // Se si sposta il gruppo, verificare che il nuovo gruppo esista
  if (input.groupId && input.groupId !== row.groupId) {
    const newGroup = await prisma.collectionGroup.findUnique({
      where: { id: input.groupId },
    });
    if (!newGroup) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Gruppo destinazione non trovato',
      });
    }
    // Aggiorna anche collectionLayoutId se il gruppo appartiene a un layout diverso
    if (newGroup.collectionLayoutId !== row.collectionLayoutId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Impossibile spostare una riga in un gruppo di un layout diverso',
      });
    }
  }

  return prisma.collectionLayoutRow.update({
    where: { id: rowId },
    data: input as any,
    include: ROW_VENDOR_INCLUDE,
  });
}

export async function deleteRow(
  rowId: string,
  prisma: PrismaClient
): Promise<void> {
  const row = await prisma.collectionLayoutRow.findUnique({
    where: { id: rowId },
  });

  if (!row) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Riga non trovata',
    });
  }

  await prisma.collectionLayoutRow.delete({ where: { id: rowId } });
}

export async function duplicateRow(
  rowId: string,
  prisma: PrismaClient
): Promise<CollectionLayoutRow> {
  const row = await prisma.collectionLayoutRow.findUnique({
    where: { id: rowId },
  });

  if (!row) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Riga non trovata',
    });
  }

  // Shift rows below the source row by 1
  await prisma.collectionLayoutRow.updateMany({
    where: {
      groupId: row.groupId,
      order: { gt: row.order },
    },
    data: { order: { increment: 1 } },
  });

  const { id: _id2, createdAt: _ca2, updatedAt: _ua2, pictureUrl: _pic2, ...rowData } = row;

  return prisma.collectionLayoutRow.create({
    data: {
      ...rowData,
      order: row.order + 1,
      pictureUrl: null, // immagine non duplicata per evitare riferimenti condivisi
    },
  });
}

export async function updateLayoutSettings(
  collectionLayoutId: string,
  input: { skuBudget?: number | null; hiddenColumns?: string[] | null },
  prisma: PrismaClient
): Promise<CollectionLayout> {
  const layout = await prisma.collectionLayout.findUnique({
    where: { id: collectionLayoutId },
  });

  if (!layout) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Collection layout non trovato',
    });
  }

  return prisma.collectionLayout.update({
    where: { id: collectionLayoutId },
    data: {
      ...('skuBudget' in input && { skuBudget: input.skuBudget }),
      ...('hiddenColumns' in input && {
        hiddenColumns: input.hiddenColumns as any,
      }),
    },
  });
}

export async function reorderRows(
  groupId: string,
  orderedIds: string[],
  prisma: PrismaClient
): Promise<void> {
  const group = await prisma.collectionGroup.findUnique({
    where: { id: groupId },
  });

  if (!group) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Gruppo non trovato',
    });
  }

  await prisma.$transaction(
    orderedIds.map((rowId, index) =>
      prisma.collectionLayoutRow.update({
        where: { id: rowId },
        data: { order: index },
      })
    )
  );
}
