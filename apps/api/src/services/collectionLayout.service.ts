/**
 * Collection Layout service — CRUD for collection layouts, groups, and rows scoped to brand+season.
 * All exported functions receive PrismaClient as their last argument.
 * Errors are surfaced as TRPCError with codes NOT_FOUND, CONFLICT, or BAD_REQUEST.
 */

import { randomUUID } from 'crypto';

import { TRPCError } from '@trpc/server';

import {
  CollectionLayoutSettingsSchema,
  type CollectionGender,
  type CollectionGroupInput,
  type CollectionLayoutRowInput,
} from '@luke/core';
import { Prisma } from '@luke/db';
import type {
  PrismaClient,
  Brand,
  CollectionLayout,
  CollectionGroup,
  CollectionLayoutRow,
  CollectionRowQuotation,
  PricingParameterSet,
} from '@luke/db';

import { isForeignKeyViolation } from '../lib/error.js';

import { assertUnlocked } from './editLock.service.js';
import { resolveDefaultPlanningGroupId } from './seasonCalendar.service.js';


// ─────────────────────────────────────────────────────────────────
// Enriched return type
// ─────────────────────────────────────────────────────────────────

export type QuotationWithParamSet = CollectionRowQuotation & {
  pricingParameterSet: PricingParameterSet | null;
};

export type RowWithVendor = CollectionLayoutRow & {
  // Derived from the select, so the casts in `getLayout` cannot hide a field the select drops.
  vendor: Prisma.CollectionLayoutRowGetPayload<{ include: typeof ROW_VENDOR_INCLUDE }>['vendor'];
  quotations: QuotationWithParamSet[];
  pictureUrl?: string | null;
};

/**
 * Verifies a planning group belongs to the same brand+season as a collection layout.
 *
 * @throws {TRPCError} NOT_FOUND if the layout or planning group does not exist.
 * @throws {TRPCError} BAD_REQUEST if they belong to a different brand/season.
 */
async function assertPlanningGroupInLayoutScope(
  layoutId: string,
  planningGroupId: string,
  prisma: PrismaClient | Prisma.TransactionClient
): Promise<void> {
  const [layout, planningGroup] = await Promise.all([
    prisma.collectionLayout.findUniqueOrThrow({
      where: { id: layoutId },
      select: { brandId: true, seasonId: true },
    }),
    prisma.planningGroup.findUnique({
      where: { id: planningGroupId },
      select: { calendar: { select: { brandId: true, seasonId: true } } },
    }),
  ]);
  if (!planningGroup) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Gruppo di pianificazione destinazione non trovato' });
  }
  if (planningGroup.calendar.brandId !== layout.brandId || planningGroup.calendar.seasonId !== layout.seasonId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Il gruppo di pianificazione appartiene a una stagione diversa',
    });
  }
}

export type CollectionLayoutWithRelations = CollectionLayout & {
  brand: Pick<Brand, 'name' | 'code' | 'logoKey'>;
  groups: (CollectionGroup & {
    rows: RowWithVendor[];
  })[];
  rows: RowWithVendor[];
};

// ─────────────────────────────────────────────────────────────────
// Common include clause
// ─────────────────────────────────────────────────────────────────

const ROW_VENDOR_INCLUDE = {
  // `moqPerColor` feeds Control's cluster MOQ coverage. Exposing it here relies on every role
  // holding `collection_layout:read` also holding `vendors:read` (`collection layout payload` in
  // packages/core/src/auth/__tests__/permissions.test.ts).
  vendor: {
    select: { id: true, name: true, nickname: true, moqPerColor: true, enabledParameterSets: { select: { id: true } } },
  },
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
  availableGenders?: CollectionGender[]
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

/** How long a copy may take before it is abandoned: the bulk inserts of 1000 rows × 2 quotations take well under it. */
const COPY_TIMEOUT_MS = 30_000;

/** A source quotation, with what its parameter set tells about its amounts. */
type SourceQuotation = CollectionRowQuotation & {
  pricingParameterSet: Pick<PricingParameterSet, 'name' | 'purchaseCurrency' | 'sellingCurrency'> | null;
};

/** A parameter set of the target brand+season. */
type TargetSet = Pick<PricingParameterSet, 'id' | 'purchaseCurrency' | 'sellingCurrency'>;

/**
 * A quotation copied into `rowId`: onto the target set of the same name, else none, each amount kept
 * only where that set keeps its currency (100 USD never becomes 100 EUR); with no set, as it was. Pure.
 */
export function copiedQuotation(q: SourceQuotation, rowId: string, targetSets: Map<string, TargetSet>) {
  const { id: _id, rowId: _rowId, createdAt: _ca, updatedAt: _ua, pricingParameterSet: sourceSet, ...data } = q;
  if (!sourceSet) return { ...data, rowId };
  const targetSet = targetSets.get(sourceSet.name);
  return {
    ...data,
    rowId,
    pricingParameterSetId: targetSet?.id ?? null,
    supplierQuotation: targetSet?.purchaseCurrency === sourceSet.purchaseCurrency ? q.supplierQuotation : null,
    retailPrice: targetSet?.sellingCurrency === sourceSet.sellingCurrency ? q.retailPrice : null,
  };
}

/**
 * The answer to a copy the database refused, or `null` to rethrow: a target planning group or
 * parameter set deleted while it ran (the transaction rolls back whole), or the time limit.
 */
export function copyFailure(err: unknown): TRPCError | null {
  if (
    isForeignKeyViolation(err, 'collection_layout_rows_planningGroupId_fkey') ||
    isForeignKeyViolation(err, 'collection_row_quotations_pricingParameterSetId_fkey')
  ) {
    return new TRPCError({
      code: 'CONFLICT',
      message: 'Un gruppo di pianificazione o un set di parametri della stagione di destinazione è cambiato durante la copia: riprova',
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2028') {
    // Any transaction failure Prisma reports as P2028: the time limit, or no connection to start it in.
    return new TRPCError({ code: 'TIMEOUT', message: 'Il database non ha completato la copia in tempo, che è stata annullata: riprova' });
  }
  return null;
}

/**
 * Copies a collection layout from one brand+season to another, into the target's own references:
 * a row goes to the target calendar's planning group of the same name, else its default group; a
 * quotation to the target parameter set of the same name (`copiedQuotation`). Rows arrive neither
 * completed nor revised, with no phase and no photo; hidden columns come along, SKU budgets do not —
 * they are the new season's targets. Optionally restricts which rows are copied and whether their
 * quotations are included.
 *
 * @param options - When provided, only the listed row IDs are copied; each entry controls quotation copy.
 * @throws {TRPCError} NOT_FOUND if the source layout does not exist.
 * @throws {TRPCError} BAD_REQUEST if the selection is empty, repeats a row, or names a row the source lacks.
 * @throws {TRPCError} CONFLICT if a layout already exists for the target brand+season, or a target
 *   reference changed during the copy (`copyFailure`).
 * @throws {TRPCError} TIMEOUT if the copy runs past `COPY_TIMEOUT_MS`.
 */
export async function copyFromSeason(
  fromBrandId: string,
  fromSeasonId: string,
  toBrandId: string,
  toSeasonId: string,
  prisma: PrismaClient,
  options?: { rows: RowCopySelection[] }
): Promise<CollectionLayoutWithRelations> {
  const rowMap = options
    ? new Map(options.rows.map(r => [r.id, r.copyQuotations]))
    : null;
  const source = await prisma.collectionLayout.findUnique({
    where: { brandId_seasonId: { brandId: fromBrandId, seasonId: fromSeasonId } },
    select: {
      availableGenders: true,
      hiddenColumns: true,
      groups: {
        orderBy: { order: 'asc' },
        select: {
          name: true,
          order: true,
          rows: {
            // Only the rows chosen, when a selection is given.
            where: rowMap ? { id: { in: [...rowMap.keys()] } } : undefined,
            orderBy: { order: 'asc' },
            include: {
              planningGroup: { select: { name: true, isDefault: true } },
              quotations: {
                orderBy: { order: 'asc' },
                include: { pricingParameterSet: { select: { name: true, purchaseCurrency: true, sellingCurrency: true } } },
              },
            },
          },
        },
      },
    },
  });

  if (!source) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Collection layout di partenza non trovato',
    });
  }

  // An empty selection, or an id outside the source, would leave a partial or empty layout reported
  // as a success, and a retry would then meet the CONFLICT below; a repeated id would let the last
  // entry silently decide its quotations.
  if (options && rowMap) {
    const found = source.groups.reduce((n, g) => n + g.rows.length, 0);
    if (rowMap.size === 0 || rowMap.size !== options.rows.length || found !== rowMap.size) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'La selezione deve contenere righe distinte del layout di partenza',
      });
    }
  }

  // Ids chosen here so groups, rows and quotations go in three bulk inserts rather than one per record.
  const groups = source.groups
    .map(g => ({ id: randomUUID(), name: g.name, order: g.order, rows: g.rows }))
    .filter(g => g.rows.length > 0);
  const rows = groups.flatMap(g => g.rows.map(row => ({ id: randomUUID(), groupId: g.id, source: row })));
  const hiddenColumns = CollectionLayoutSettingsSchema.shape.hiddenColumns.safeParse(source.hiddenColumns).data;

  let layoutId: string;
  try {
    layoutId = await prisma.$transaction(async tx => {
      // The unique (brand, season) decides between concurrent copies, and only this insert's refusal means it.
      const layout = await tx.collectionLayout
        .create({
          data: {
            brandId: toBrandId,
            seasonId: toSeasonId,
            availableGenders: source.availableGenders,
            hiddenColumns: hiddenColumns ?? Prisma.JsonNull,
          },
          select: { id: true },
        })
        .catch((err: unknown) => {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
            throw new TRPCError({ code: 'CONFLICT', message: 'Esiste già un collection layout per questo brand/stagione' });
          }
          if (isForeignKeyViolation(err, 'collection_layouts_brandId_fkey') || isForeignKeyViolation(err, 'collection_layouts_seasonId_fkey')) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand o stagione di destinazione non trovati' });
          }
          throw err;
        });

      const planningGroups = await tx.planningGroup.findMany({
        where: { calendar: { brandId: toBrandId, seasonId: toSeasonId } },
        select: { id: true, name: true, isDefault: true },
      });
      const parameterSets = await tx.pricingParameterSet.findMany({
        where: { brandId: toBrandId, seasonId: toSeasonId },
        select: { id: true, name: true, purchaseCurrency: true, sellingCurrency: true },
      });
      const planningGroupByName = new Map(planningGroups.map(pg => [pg.name, pg.id]));
      const setByName = new Map(parameterSets.map(ps => [ps.name, ps]));
      // A row in the default group (matched by `isDefault`, never by name: #128), or in a group of a
      // name the target lacks, goes to the target's default group — created, with the target
      // calendar, only when such a row needs it.
      let defaultPlanningGroupId = planningGroups.find(pg => pg.isDefault)?.id;
      const rowData = [];
      for (const { id, groupId, source: row } of rows) {
        const {
          id: _id, collectionLayoutId: _cid, groupId: _gid, createdAt: _ca, updatedAt: _ua,
          planningGroup, quotations: _quotations, ...data
        } = row;
        rowData.push({
          ...data,
          id,
          collectionLayoutId: layout.id,
          groupId,
          planningGroupId: (planningGroup.isDefault ? undefined : planningGroupByName.get(planningGroup.name))
            ?? (defaultPlanningGroupId ??= await resolveDefaultPlanningGroupId(toBrandId, toSeasonId, tx)),
          phaseId: null,
          pictureKey: null,
          completedAt: null,
          lastRevisedAt: null,
        });
      }

      await tx.collectionGroup.createMany({
        data: groups.map(g => ({ id: g.id, collectionLayoutId: layout.id, name: g.name, order: g.order })),
      });
      await tx.collectionLayoutRow.createMany({ data: rowData });
      await tx.collectionRowQuotation.createMany({
        data: rows.flatMap(({ id, source: row }) =>
          (rowMap?.get(row.id) ?? true) ? row.quotations.map(q => copiedQuotation(q, id, setByName)) : []
        ),
      });
      return layout.id;
    }, { timeout: COPY_TIMEOUT_MS });
  } catch (err) {
    throw copyFailure(err) ?? err;
  }

  // Read after the commit: the transaction holds only the writes. Cast as `getLayout` does: the
  // `LAYOUT_INCLUDE` payload is `CollectionLayoutWithRelations` less the URLs the router resolves.
  return prisma.collectionLayout.findUniqueOrThrow({
    where: { id: layoutId },
    include: LAYOUT_INCLUDE,
  }) as Promise<CollectionLayoutWithRelations>;
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
  prisma: PrismaClient,
  userId: string
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
  await assertUnlocked('COLLECTION_LAYOUT', group.collectionLayoutId, userId, prisma);

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
  prisma: PrismaClient,
  userId: string
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
  await assertUnlocked('COLLECTION_LAYOUT', group.collectionLayoutId, userId, prisma);

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
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string
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
  await assertUnlocked('COLLECTION_LAYOUT', group.collectionLayoutId, userId, prisma);

  // Validate gender against layout availableGenders
  const availableGenders = group.collectionLayout.availableGenders;
  if (availableGenders.length > 0 && !availableGenders.includes(input.gender)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Gender '${input.gender}' non disponibile per questo layout`,
    });
  }

  const existingCount = await prisma.collectionLayoutRow.count({
    where: { groupId: input.groupId },
  });

  const { order, planningGroupId, ...rowData } = input;
  const resolvedPlanningGroupId = planningGroupId ?? await resolveDefaultPlanningGroupId(
    group.collectionLayout.brandId,
    group.collectionLayout.seasonId,
    prisma
  );

  return prisma.collectionLayoutRow.create({
    data: {
      collectionLayoutId: group.collectionLayoutId,
      planningGroupId: resolvedPlanningGroupId,
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
 * The error that freezes a completed row. A completed row shows an outcome measured against its
 * phase and its planning group's milestones: moving either without reopening it would change
 * that outcome after the fact. The other fields stay editable — completion concerns progress,
 * not the row's master data.
 *
 * Single message for both write paths (single row and bulk assignment), so they can't diverge
 * and tell the user two different rules for the same constraint.
 */
function completedRowConflict(count: number): TRPCError {
  return new TRPCError({
    code: 'CONFLICT',
    message: count === 1
      ? 'Riga conclusa: riaprila prima di cambiare fase o gruppo di pianificazione.'
      : `${count} righe della selezione sono concluse: riaprile prima di cambiarne il gruppo di pianificazione.`,
  });
}

/**
 * Updates fields on a collection row. Validates gender against the layout's filter
 * and, if moving to a different group, ensures the destination belongs to the same layout.
 *
 * @param existingRow - Caller-fetched row state, reused instead of a redundant internal
 *   `findUnique` — the row-drawer save path (only caller) already fetches this for its own
 *   before/after audit diff.
 * @throws {TRPCError} CONFLICT if the row is completed and the phase or planning group changes.
 * @throws {TRPCError} NOT_FOUND if the destination group does not exist.
 * @throws {TRPCError} BAD_REQUEST if the gender or cross-layout move is invalid.
 */
export async function updateRow(
  rowId: string,
  input: Partial<CollectionLayoutRowInput>,
  existingRow: Pick<CollectionLayoutRow, 'collectionLayoutId' | 'groupId' | 'phaseId' | 'planningGroupId' | 'completedAt'>,
  prisma: PrismaClient | Prisma.TransactionClient,
  userId: string
): Promise<RowWithVendor> {
  await assertUnlocked('COLLECTION_LAYOUT', existingRow.collectionLayoutId, userId, prisma);

  const movesPhase = input.phaseId !== undefined && input.phaseId !== existingRow.phaseId;
  const movesPlanningGroup = input.planningGroupId !== undefined && input.planningGroupId !== existingRow.planningGroupId;
  if (existingRow.completedAt !== null && (movesPhase || movesPlanningGroup)) {
    throw completedRowConflict(1);
  }

  if (input.gender) {
    const layout = await prisma.collectionLayout.findUnique({
      where: { id: existingRow.collectionLayoutId },
      select: { availableGenders: true },
    });
    const availableGenders = layout?.availableGenders;
    if (availableGenders && availableGenders.length > 0 && !availableGenders.includes(input.gender)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Gender '${input.gender}' non disponibile per questo layout`,
      });
    }
  }

  // If moving the planning group, verify it belongs to the same layout
  if (input.planningGroupId && input.planningGroupId !== existingRow.planningGroupId) {
    await assertPlanningGroupInLayoutScope(existingRow.collectionLayoutId, input.planningGroupId, prisma);
  }

  // If moving the group, verify the new group exists
  if (input.groupId && input.groupId !== existingRow.groupId) {
    const newGroup = await prisma.collectionGroup.findUnique({
      where: { id: input.groupId },
    });
    if (!newGroup) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Gruppo destinazione non trovato',
      });
    }
    if (newGroup.collectionLayoutId !== existingRow.collectionLayoutId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Impossibile spostare una riga in un gruppo di un layout diverso',
      });
    }
  }

  const updated = await prisma.collectionLayoutRow.update({
    where: { id: rowId },
    // Unchecked: the domain treats FKs (groupId, vendorId, etc.) as direct
    // scalars, not relation-connect — Prisma requires the explicit type to
    // pick that branch of the union instead of the other.
    data: input as Prisma.CollectionLayoutRowUncheckedUpdateInput,
    include: ROW_VENDOR_INCLUDE,
  }) as RowWithVendor;

  // Phase history hook: record every transition, never a separate job — avoids drift between
  // the row's live phaseId and its history.
  if (input.phaseId != null && input.phaseId !== existingRow.phaseId) {
    await prisma.collectionRowPhaseHistory.create({
      data: {
        rowId,
        phaseId: input.phaseId,
        reachedAt: new Date(),
        recordedByUserId: userId ?? null,
      },
    });
  }

  return updated;
}

/**
 * Bulk-assigns a set of rows, all already known to belong to `layoutId`, to a planning group.
 * Callers are expected to have resolved and validated `layoutId` from `rowIds` themselves.
 *
 * @throws {TRPCError} BAD_REQUEST if the target planning group belongs to a different brand/season.
 */
export async function bulkAssignRowsPlanningGroup(
  rowIds: string[],
  layoutId: string,
  planningGroupId: string,
  prisma: PrismaClient,
  userId: string
): Promise<{ success: true; count: number }> {
  await assertUnlocked('COLLECTION_LAYOUT', layoutId, userId, prisma);
  await assertPlanningGroupInLayoutScope(layoutId, planningGroupId, prisma);

  // Same constraint as `updateRow`, applied before the updateMany. Completed rows are not
  // filtered out of the selection: a bulk action that silently skips part of it is worse than an
  // error, because the returned count would look like an intended partial success.
  const completedCount = await prisma.collectionLayoutRow.count({
    where: { id: { in: rowIds }, completedAt: { not: null } },
  });
  if (completedCount > 0) throw completedRowConflict(completedCount);

  const { count } = await prisma.collectionLayoutRow.updateMany({
    where: { id: { in: rowIds }, planningGroupId: { not: planningGroupId } },
    data: { planningGroupId },
  });

  return { success: true, count };
}

/**
 * Marks the row as completed, or reopens it. Lives here and not in the router because it's the
 * only other place that writes to a row: keeping it next to `updateRow` puts the "completed row"
 * invariant and its enforcer on the same side of the boundary.
 *
 * When completing, `completedAt: null` in the `where` makes the operation idempotent: a second
 * call doesn't overwrite the date of the first completion, which is the value the outcome is
 * measured against. Reopening always resets it.
 *
 * @returns The resulting row state — `completedAt` is what the caller records in the audit log.
 */
export async function setRowCompleted(
  rowId: string,
  completed: boolean,
  prisma: PrismaClient
): Promise<{ id: string; completedAt: Date | null }> {
  return prisma.$transaction(async tx => {
    await tx.collectionLayoutRow.updateMany({
      where: { id: rowId, ...(completed ? { completedAt: null } : {}) },
      data: { completedAt: completed ? new Date() : null },
    });
    return tx.collectionLayoutRow.findUniqueOrThrow({
      where: { id: rowId },
      select: { id: true, completedAt: true },
    });
  });
}

/**
 * Deletes a collection row.
 *
 * @throws {TRPCError} NOT_FOUND if the row does not exist.
 */
export async function deleteRow(
  rowId: string,
  prisma: PrismaClient,
  userId: string
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
  await assertUnlocked('COLLECTION_LAYOUT', row.collectionLayoutId, userId, prisma);

  await prisma.collectionLayoutRow.delete({ where: { id: rowId } });
}

/**
 * Duplicates a row, inserting the copy immediately after the source row and shifting
 * subsequent rows down by 1. Quotations are copied; picture key is not (shared references avoided).
 *
 * @throws {TRPCError} NOT_FOUND if the source row does not exist.
 * @throws {TRPCError} CONFLICT if a copied quotation's parameter set was deleted meanwhile; the
 *   copy rolls back whole.
 */
export async function duplicateRow(
  rowId: string,
  prisma: PrismaClient,
  userId: string
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
  await assertUnlocked('COLLECTION_LAYOUT', row.collectionLayoutId, userId, prisma);

  try {
    return await prisma.$transaction(async tx => {
      // Shift rows below source by +1
      await tx.collectionLayoutRow.updateMany({
        where: {
          groupId: row.groupId,
          order: { gt: row.order },
        },
        data: { order: { increment: 1 } },
      });

      const { id: _id, createdAt: _ca, updatedAt: _ua, pictureKey: _pic, quotations, ...rowData } = row;

      const newRow = await tx.collectionLayoutRow.create({
        data: {
          ...rowData,
          order: row.order + 1,
          pictureKey: null, // picture not duplicated, to avoid shared references
        },
      });

      // Duplicate quotations
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
  } catch (err) {
    // `removeParameterSet` refuses a set in use, so a set deleted between the read above and the
    // copy is the only way a quotation's foreign key can refuse here.
    if (isForeignKeyViolation(err, 'collection_row_quotations_pricingParameterSetId_fkey')) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Un set di parametri della riga è stato eliminato durante la duplicazione: riprova',
      });
    }
    throw err;
  }
}

/**
 * Updates layout-level settings: SKU budget, hidden columns, or available genders.
 *
 * @throws {TRPCError} NOT_FOUND if the layout does not exist.
 */
export async function updateLayoutSettings(
  collectionLayoutId: string,
  input: { skuBudget?: number | null; hiddenColumns?: string[] | null; availableGenders?: CollectionGender[] },
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
        // Json? column: Prisma requires an explicit Prisma.JsonNull, not a direct `null`
        hiddenColumns: input.hiddenColumns === null ? Prisma.JsonNull : input.hiddenColumns,
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
  prisma: PrismaClient,
  userId: string
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
  await assertUnlocked('COLLECTION_LAYOUT', group.collectionLayoutId, userId, prisma);

  // `updateMany` with `groupId` in the where: see `reorderQuotations`. An id
  // that doesn't belong to the group is left untouched instead of being reordered.
  await prisma.$transaction(
    orderedIds.map((rowId, index) =>
      prisma.collectionLayoutRow.updateMany({
        where: { id: rowId, groupId },
        data: { order: index },
      })
    )
  );
}

/**
 * Builds a map of Phase id → display label from the Phase catalog, retired phases included: an
 * export still names the phase a concluded row stopped on.
 *
 * @returns Map keyed by Phase id.
 */
export async function buildProgressLabelMap(
  prisma: PrismaClient,
): Promise<Map<string, string>> {
  const items = await prisma.phase.findMany({
    select: { id: true, label: true },
  });
  return new Map(items.map(p => [p.id, p.label]));
}

