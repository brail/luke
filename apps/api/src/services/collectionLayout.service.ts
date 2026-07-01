/**
 * Collection Layout service — CRUD for collection layouts, groups, and rows scoped to brand+season.
 * All exported functions receive PrismaClient as their last argument.
 * Errors are surfaced as TRPCError with codes NOT_FOUND, CONFLICT, or BAD_REQUEST.
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
  vendor: (Pick<Vendor, 'id' | 'name' | 'nickname'> & { enabledParameterSets: Pick<PricingParameterSet, 'id'>[] }) | null;
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
  vendor: { select: { id: true, name: true, nickname: true, enabledParameterSets: { select: { id: true } } } },
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

/**
 * Fetches the collection layout for a brand+season combination, including all groups,
 * rows, vendor info, and quotations ordered by their display order.
 *
 * @returns The layout with relations, or null if not yet created.
 */
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

/**
 * Returns the existing collection layout for a brand+season, or creates an empty one
 * if none exists yet.
 *
 * @param availableGenders - Optional gender filter to set on creation.
 */
export async function getOrCreateLayout(
  brandId: string,
  seasonId: string,
  prisma: PrismaClient,
  availableGenders?: string[]
): Promise<CollectionLayoutWithRelations> {
  return prisma.collectionLayout.upsert({
    where: { brandId_seasonId: { brandId, seasonId } },
    create: {
      brandId,
      seasonId,
      ...(availableGenders && { availableGenders }),
    },
    update: {},
    include: LAYOUT_INCLUDE,
  }) as Promise<CollectionLayoutWithRelations>;
}

type RowCopySelection = { id: string; copyQuotations: boolean };

/**
 * Copies a collection layout from one brand+season to another. Optionally restricts which
 * rows are copied and whether their quotations are included.
 *
 * @param options - When provided, only the listed row IDs are copied; each entry controls quotation copy.
 * @throws {TRPCError} NOT_FOUND if the source layout does not exist.
 * @throws {TRPCError} CONFLICT if a layout already exists for the target brand+season.
 */
export async function copyFromSeason(
  fromBrandId: string,
  fromSeasonId: string,
  toBrandId: string,
  toSeasonId: string,
  prisma: PrismaClient,
  options?: { rows: RowCopySelection[] }
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

  const rowMap = options
    ? new Map(options.rows.map(r => [r.id, r.copyQuotations]))
    : null;

  return prisma.$transaction(async tx => {
    const newLayout = await tx.collectionLayout.create({
      data: {
        brandId: toBrandId,
        seasonId: toSeasonId,
        availableGenders: (source as any).availableGenders,
      },
    });

    for (const group of (source as CollectionLayoutWithRelations).groups) {
      const rows = rowMap
        ? group.rows.filter(r => rowMap.has(r.id))
        : group.rows;

      if (rows.length === 0) continue;

      const newGroup = await tx.collectionGroup.create({
        data: {
          collectionLayoutId: newLayout.id,
          name: group.name,
          order: group.order,
        },
      });

      for (const row of rows) {
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
            pictureKey: null,
            phaseId: null,
          },
        });

        const shouldCopyQuotations = rowMap?.get(row.id) ?? true;
        if (shouldCopyQuotations) {
          for (const q of row.quotations) {
            const { id: _qid, rowId: _qrowId, createdAt: _qca, updatedAt: _qua, pricingParameterSet: _ps, ...qData } = q;
            await tx.collectionRowQuotation.create({
              data: { ...qData, rowId: newRow.id },
            });
          }
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

/**
 * Creates a new group in the given collection layout.
 *
 * @throws {TRPCError} NOT_FOUND if the layout does not exist.
 */
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

/**
 * Updates an existing group's name, order, or SKU budget.
 *
 * @throws {TRPCError} NOT_FOUND if the group does not exist.
 */
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

/**
 * Deletes a group and all its rows (cascaded by DB relation).
 *
 * @throws {TRPCError} NOT_FOUND if the group does not exist.
 */
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

/**
 * Creates a new row in the specified group. Validates that the gender is allowed by the
 * layout's availableGenders filter.
 *
 * @throws {TRPCError} NOT_FOUND if the group does not exist.
 * @throws {TRPCError} BAD_REQUEST if the gender is not in the layout's allowed set.
 */
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
      phaseId: rowData.phaseId ?? null,
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

/**
 * Updates fields on a collection row. Validates gender against the layout's filter
 * and, if moving to a different group, ensures the destination belongs to the same layout.
 *
 * @throws {TRPCError} NOT_FOUND if the row or destination group does not exist.
 * @throws {TRPCError} BAD_REQUEST if the gender or cross-layout move is invalid.
 */
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

/**
 * Deletes a collection row.
 *
 * @throws {TRPCError} NOT_FOUND if the row does not exist.
 */
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

/**
 * Duplicates a row, inserting the copy immediately after the source row and shifting
 * subsequent rows down by 1. Quotations are copied; picture key is not (shared references avoided).
 *
 * @throws {TRPCError} NOT_FOUND if the source row does not exist.
 */
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

/**
 * Updates layout-level settings: SKU budget, hidden columns, or available genders.
 *
 * @throws {TRPCError} NOT_FOUND if the layout does not exist.
 */
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

/**
 * Reassigns the order index of all rows in a group based on the provided ordered ID list.
 *
 * @param orderedIds - Row IDs in the desired display order (0-indexed).
 * @throws {TRPCError} NOT_FOUND if the group does not exist.
 */
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

/**
 * Builds a map of Phase id → display label from the Phase catalog.
 * Labels are formatted as "CODE — label" when a code is present.
 *
 * @returns Map keyed by Phase id.
 */
export async function buildProgressLabelMap(
  prisma: PrismaClient,
): Promise<Map<string, string>> {
  const items = await prisma.phase.findMany({
    select: { id: true, code: true, label: true },
  });
  return new Map(items.map(p => [p.id, p.code ? `${p.code} — ${p.label}` : p.label]));
}

