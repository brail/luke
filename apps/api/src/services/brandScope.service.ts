/**
 * Brand scope: who can touch which brand.
 *
 * `requirePermission` answers "can this role read prices?". It does not
 * answer "can this user read prices **for this brand**?". The two
 * questions have been conflated in several routers, and this module is the
 * only place where the second one gets an answer.
 *
 * ## Why here and not elsewhere
 *
 * Not in `collectionLayout.service.ts`: that module deliberately receives a
 * bare `prisma`, because it's invoked with the transaction client from inside
 * `$transaction`, and from other services where "who is the user" isn't in
 * scope. The guards need the session.
 *
 * Not in `context.service.ts`: that resolves the current brand and season,
 * which is a different responsibility. It keeps re-exporting `assertBrandAccess`
 * for routers that already imported it from there.
 *
 * ## A single implementation
 *
 * There used to be two identically-named ones with different signatures:
 * `(ctx, brandId)` and `(userId, brandId, prisma, userRole?)`. The second had
 * `userRole` as **optional** and all 15 of its callers omitted it — without
 * that parameter `getUserAllowedBrandIds` never takes the early return for
 * admins, so an admin who didn't belong to any team got `[]` back and ended up
 * FORBIDDEN on half the season calendar. The patch was a hand-written
 * `hasPermission({ role }, '*:*')` in the one place someone had noticed. With a
 * single signature the problem can no longer be expressed.
 */

import { TRPCError } from '@trpc/server';

import { type Role } from '@luke/core';

import { getUserAllowedBrandIds } from './context.service';

import type { PrismaClient } from '@prisma/client';

/**
 * The minimum a guard needs.
 *
 * Structural and not `Context` because non-tRPC Fastify routes
 * (`seasonCalendarExport.routes.ts`) have prisma and session but no tRPC
 * context, and must be able to use the same guards.
 */
export interface BrandScopeCtx {
  prisma: PrismaClient;
  session: { user: { id: string; role: string } } | null;
  /** See `allowedBrandIds`. Present on `Context`, optional elsewhere. */
  _allowedBrandIdsPromise?: Promise<string[] | null>;
}

/**
 * The brands accessible to the requesting user, resolved once.
 *
 * Memoizes the **promise**, not the value: `seasonCalendar.listEvents` and
 * `copyFromSeason` fire multiple guards in parallel with `Promise.all`, and
 * with a value cache each one would start before the first had finished,
 * missing it every time. Result: one `companyTeamMembership.findMany` per
 * request instead of one per guard, and zero for admins.
 *
 * If the query rejects, every subsequent `await` in the same request inherits
 * the rejection. That's intentional — the request must fail, not retry.
 */
async function allowedBrandIds(ctx: BrandScopeCtx): Promise<string[] | null> {
  if (!ctx.session) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Devi essere autenticato per accedere a questa risorsa',
    });
  }

  // Watch out with `{ ...ctx, prisma: tx }`: the spread copies the slot by value, and
  // the `??=` would write to the copy. If a transaction client is needed, pass it
  // as an explicit parameter.
  ctx._allowedBrandIdsPromise ??= getUserAllowedBrandIds(
    ctx.session.user.id,
    ctx.prisma,
    ctx.session.user.role as Role
  );

  return ctx._allowedBrandIdsPromise;
}

/**
 * Throws FORBIDDEN if the user doesn't have access to the brand.
 *
 * Access is **strict opt-in**: `null` (no restriction) is reserved for
 * admins; for everyone else it's exactly the union of the `brandScopes` of
 * active teams. No team means no brand, not "all of them".
 *
 * @param brandId - For resources identified by a different id (a layout, a
 *   row) pass the `brandId` resolved from the record, never an input field.
 */
export async function assertBrandAccess(
  ctx: BrandScopeCtx,
  brandId: string
): Promise<void> {
  const allowed = await allowedBrandIds(ctx);

  if (allowed !== null && !allowed.includes(brandId)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Accesso al brand non consentito',
    });
  }
}

/**
 * Like `assertBrandAccess`, over multiple brands.
 *
 * Used by procedures that copy between brands: `collectionLayout.copyFromSeason`
 * and `seasonCalendar.cloneFromBrandSeason` take a source and a destination, and
 * **both** checks are needed. Only checking the source lets you write into a
 * brand that isn't yours; only checking the destination is exfiltration — you
 * read another brand's collection by cloning it into your own.
 */
export async function assertBrandAccessAll(
  ctx: BrandScopeCtx,
  brandIds: string[]
): Promise<void> {
  const allowed = await allowedBrandIds(ctx);
  if (allowed === null) return;

  const denied = brandIds.find(id => !allowed.includes(id));
  if (denied !== undefined) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Accesso al brand non consentito',
    });
  }
}

/**
 * Restricts a list of brands to the accessible ones. Returns it intact for
 * admins.
 *
 * Different from `assertBrandAccessAll`: here an inaccessible brand is
 * silently excluded instead of making the request fail. That's the right
 * behavior for a filterable view (the calendar), not for a mutation.
 */
export async function filterAllowedBrandIds(
  ctx: BrandScopeCtx,
  requestedBrandIds: string[]
): Promise<string[]> {
  const allowed = await allowedBrandIds(ctx);
  if (allowed === null) return requestedBrandIds;
  return requestedBrandIds.filter(id => allowed.includes(id));
}

// ─── Per-resource resolvers ─────────────────────────────────────────────────────
//
// Each one resolves the `brandId` starting from the resource's id, verifies
// access, and returns the record. They throw NOT_FOUND before FORBIDDEN: a
// nonexistent id isn't a permission problem.
//
// Chains: layout → `brandId` (0 hop) · group and row → `collectionLayout.brandId`
// (1 hop, `collectionLayoutId` is denormalized on the row) · quotation →
// `row.collectionLayout.brandId` (2 hop).

/** Layout, by `collectionLayoutId`. */
export async function resolveLayoutBrandAccess(
  ctx: BrandScopeCtx,
  collectionLayoutId: string
) {
  const layout = await ctx.prisma.collectionLayout.findUnique({
    where: { id: collectionLayoutId },
    select: { id: true, brandId: true, seasonId: true },
  });
  if (!layout) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Layout non trovato' });
  }

  await assertBrandAccess(ctx, layout.brandId);
  return layout;
}

/** Group, by `groupId`. */
export async function resolveGroupBrandAccess(
  ctx: BrandScopeCtx,
  groupId: string
) {
  const group = await ctx.prisma.collectionGroup.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      collectionLayoutId: true,
      collectionLayout: { select: { brandId: true, seasonId: true } },
    },
  });
  if (!group) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Gruppo non trovato' });
  }

  await assertBrandAccess(ctx, group.collectionLayout.brandId);
  return group;
}

/** Row, by `rowId`. */
export async function resolveRowBrandAccess(ctx: BrandScopeCtx, rowId: string) {
  const row = await ctx.prisma.collectionLayoutRow.findUnique({
    where: { id: rowId },
    select: {
      id: true,
      collectionLayoutId: true,
      groupId: true,
      collectionLayout: { select: { brandId: true, seasonId: true } },
    },
  });
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Riga non trovata' });
  }

  await assertBrandAccess(ctx, row.collectionLayout.brandId);
  return row;
}

/** Quotation, by `quotationId`. */
export async function resolveQuotationBrandAccess(
  ctx: BrandScopeCtx,
  quotationId: string
) {
  const quotation = await ctx.prisma.collectionRowQuotation.findUnique({
    where: { id: quotationId },
    select: {
      id: true,
      rowId: true,
      row: { select: { collectionLayout: { select: { brandId: true } } } },
    },
  });
  if (!quotation) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Quotazione non trovata',
    });
  }

  await assertBrandAccess(ctx, quotation.row.collectionLayout.brandId);
  return quotation;
}

/**
 * Multiple rows, by `rowIds`. Requires that they all belong to the same
 * layout — that's the assumption `bulkAssignRowsPlanningGroup` documents but
 * didn't verify.
 *
 * @returns The shared layout's id.
 */
export async function resolveRowsBrandAccess(
  ctx: BrandScopeCtx,
  rowIds: string[]
): Promise<string> {
  const rows = await ctx.prisma.collectionLayoutRow.findMany({
    where: { id: { in: rowIds } },
    select: {
      collectionLayoutId: true,
      collectionLayout: { select: { brandId: true } },
    },
  });

  if (rows.length !== rowIds.length) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Una o più righe non trovate',
    });
  }

  const layoutIds = new Set(rows.map(r => r.collectionLayoutId));
  if (layoutIds.size !== 1) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Le righe devono appartenere allo stesso layout',
    });
  }

  await assertBrandAccess(ctx, rows[0].collectionLayout.brandId);
  return rows[0].collectionLayoutId;
}

/** Revision, by `revisionId`. */
export async function resolveRevisionBrandAccess(
  ctx: BrandScopeCtx,
  revisionId: string
) {
  const revision = await ctx.prisma.collectionLayoutRevision.findUnique({
    where: { id: revisionId },
    select: {
      id: true,
      collectionLayoutId: true,
      collectionLayout: { select: { brandId: true } },
    },
  });
  if (!revision) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Revisione non trovata' });
  }

  await assertBrandAccess(ctx, revision.collectionLayout.brandId);
  return revision;
}

/**
 * Merchandising plan row, by `rowId`.
 *
 * A chain distinct from the collection layout's: `MerchandisingPlanRow.planId`
 * → `MerchandisingPlan.brandId`. The ids are uuids, indistinguishable by eye,
 * and the two `rowId`s live in different routers.
 */
export async function resolveMerchPlanRowBrandAccess(
  ctx: BrandScopeCtx,
  rowId: string
) {
  const row = await ctx.prisma.merchandisingPlanRow.findUnique({
    where: { id: rowId },
    select: { id: true, planId: true, plan: { select: { brandId: true } } },
  });
  if (!row) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Riga non trovata' });
  }

  await assertBrandAccess(ctx, row.plan.brandId);
  return row;
}

/** Planning group, by `planningGroupId`. */
export async function resolvePlanningGroupBrandAccess(
  ctx: BrandScopeCtx,
  planningGroupId: string
) {
  const group = await ctx.prisma.planningGroup.findUnique({
    where: { id: planningGroupId },
    select: {
      calendarId: true,
      anchorDate: true,
      calendar: { select: { brandId: true, seasonId: true } },
    },
  });
  if (!group) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: 'Gruppo di pianificazione non trovato',
    });
  }

  await assertBrandAccess(ctx, group.calendar.brandId);
  return group;
}
