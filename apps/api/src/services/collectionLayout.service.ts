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
  Brand,
  CollectionLayout,
  CollectionGroup,
  CollectionLayoutRow,
  CollectionRowQuotation,
  PricingParameterSet,
  Vendor,
} from '@prisma/client';

// ─────────────────────────────────────────────────────────────────
// Tipo di ritorno arricchito
// ─────────────────────────────────────────────────────────────────

export type QuotationWithParamSet = CollectionRowQuotation & {
  pricingParameterSet: PricingParameterSet | null;
};

export type RowWithVendor = CollectionLayoutRow & {
  vendor: Pick<Vendor, 'id' | 'name' | 'nickname'> | null;
  quotations: QuotationWithParamSet[];
  pictureUrl?: string | null;
};

export type CollectionLayoutWithRelations = CollectionLayout & {
  brand: Pick<Brand, 'name' | 'code' | 'logoKey'>;
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
  quotations: {
    orderBy: { order: 'asc' as const },
    include: { pricingParameterSet: true },
  },
} as const;

const LAYOUT_INCLUDE = {
  brand: { select: { name: true, code: true, logoKey: true } },
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
  }) as Promise<CollectionLayoutWithRelations | null>;
}

export async function getOrCreateLayout(
  brandId: string,
  seasonId: string,
  prisma: PrismaClient,
  availableGenders?: string[]
): Promise<CollectionLayoutWithRelations> {
  const existing = await prisma.collectionLayout.findUnique({
    where: { brandId_seasonId: { brandId, seasonId } },
    include: LAYOUT_INCLUDE,
  });

  if (existing) return existing as CollectionLayoutWithRelations;

  return prisma.collectionLayout.create({
    data: {
      brandId,
      seasonId,
      ...(availableGenders && { availableGenders }),
    },
    include: LAYOUT_INCLUDE,
  }) as Promise<CollectionLayoutWithRelations>;
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
      data: {
        brandId: toBrandId,
        seasonId: toSeasonId,
        availableGenders: (source as any).availableGenders,
      },
    });

    for (const group of (source as CollectionLayoutWithRelations).groups) {
      const newGroup = await tx.collectionGroup.create({
        data: {
          collectionLayoutId: newLayout.id,
          name: group.name,
          order: group.order,
        },
      });

      for (const row of group.rows) {
        const {
          id: _id,
          collectionLayoutId: _cid,
          groupId: _gid,
          createdAt: _ca,
          updatedAt: _ua,
          pictureKey: _pic,
          vendor: _vendor,
          quotations: _quotations,
          ...rowData
        } = row as RowWithVendor;

        const newRow = await tx.collectionLayoutRow.create({
          data: {
            ...rowData,
            collectionLayoutId: newLayout.id,
            groupId: newGroup.id,
            pictureKey: null, // image non copiata intenzionalmente
          },
        });

        // Copia quotazioni senza pictureKey
        for (const q of row.quotations) {
          const { id: _qid, rowId: _qrowId, createdAt: _qca, updatedAt: _qua, pricingParameterSet: _ps, ...qData } = q;
          await tx.collectionRowQuotation.create({
            data: { ...qData, rowId: newRow.id },
          });
        }
      }
    }

    return tx.collectionLayout.findUniqueOrThrow({
      where: { id: newLayout.id },
      include: LAYOUT_INCLUDE,
    }) as Promise<CollectionLayoutWithRelations>;
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
): Promise<RowWithVendor> {
  const group = await prisma.collectionGroup.findUnique({
    where: { id: input.groupId },
    include: { collectionLayout: { select: { brandId: true, seasonId: true, availableGenders: true } } },
  });

  if (!group) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Gruppo non trovato',
    });
  }

  // Validate gender against layout availableGenders
  const availableGenders = (group.collectionLayout as any).availableGenders as string[];
  if (availableGenders.length > 0 && !availableGenders.includes(input.gender)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Gender '${input.gender}' non disponibile per questo layout`,
    });
  }

  const existingCount = await prisma.collectionLayoutRow.count({
    where: { groupId: input.groupId },
  });

  const { order, ...rowData } = input;

  return prisma.collectionLayoutRow.create({
    data: {
      collectionLayoutId: group.collectionLayoutId,
      order: order ?? existingCount,
      gender: rowData.gender,
      vendorId: rowData.vendorId ?? null,
      line: rowData.line,
      article: rowData.article ?? null,
      status: rowData.status,
      skuForecast: rowData.skuForecast,
      qtyForecast: rowData.qtyForecast,
      productCategory: rowData.productCategory,
      strategy: rowData.strategy ?? null,
      styleStatus: rowData.styleStatus ?? null,
      progress: rowData.progress ?? null,
      designer: rowData.designer ?? null,
      pictureKey: rowData.pictureKey ?? null,
      styleNotes: rowData.styleNotes ?? null,
      materialNotes: rowData.materialNotes ?? null,
      colorNotes: rowData.colorNotes ?? null,
      toolingNotes: rowData.toolingNotes ?? null,
      toolingQuotation: rowData.toolingQuotation ?? null,
      groupId: input.groupId,
    },
    include: ROW_VENDOR_INCLUDE,
  }) as Promise<RowWithVendor>;
}

export async function updateRow(
  rowId: string,
  input: Partial<CollectionLayoutRowInput>,
  prisma: PrismaClient
): Promise<RowWithVendor> {
  const row = await prisma.collectionLayoutRow.findUnique({
    where: { id: rowId },
  });

  if (!row) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Riga non trovata',
    });
  }

  if (input.gender) {
    const layout = await prisma.collectionLayout.findUnique({
      where: { id: row.collectionLayoutId },
      select: { availableGenders: true },
    });
    const availableGenders = (layout as any)?.availableGenders as string[] | undefined;
    if (availableGenders && availableGenders.length > 0 && !availableGenders.includes(input.gender)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Gender '${input.gender}' non disponibile per questo layout`,
      });
    }
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
  }) as Promise<RowWithVendor>;
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
): Promise<RowWithVendor> {
  const row = await prisma.collectionLayoutRow.findUnique({
    where: { id: rowId },
    include: {
      quotations: {
        orderBy: { order: 'asc' as const },
        include: { pricingParameterSet: true },
      },
    },
  });

  if (!row) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Riga non trovata',
    });
  }

  return prisma.$transaction(async tx => {
    // Shift rows below source by +1
    await tx.collectionLayoutRow.updateMany({
      where: {
        groupId: row.groupId,
        order: { gt: row.order },
      },
      data: { order: { increment: 1 } },
    });

    const { id: _id, createdAt: _ca, updatedAt: _ua, pictureKey: _pic, quotations, ...rowData } = row as any;

    const newRow = await tx.collectionLayoutRow.create({
      data: {
        ...rowData,
        order: row.order + 1,
        pictureKey: null, // immagine non duplicata per evitare riferimenti condivisi
      },
    });

    // Duplica quotazioni
    for (const q of quotations) {
      const { id: _qid, rowId: _qrowId, createdAt: _qca, updatedAt: _qua, pricingParameterSet: _ps, ...qData } = q;
      await tx.collectionRowQuotation.create({
        data: { ...qData, rowId: newRow.id },
      });
    }

    return tx.collectionLayoutRow.findUniqueOrThrow({
      where: { id: newRow.id },
      include: ROW_VENDOR_INCLUDE,
    }) as Promise<RowWithVendor>;
  });
}

export async function updateLayoutSettings(
  collectionLayoutId: string,
  input: { skuBudget?: number | null; hiddenColumns?: string[] | null; availableGenders?: string[] },
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
      ...(input.availableGenders && { availableGenders: input.availableGenders }),
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
