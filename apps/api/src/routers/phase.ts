/**
 * tRPC router for the unified Phase catalog.
 * Replaces the two parallel domains CollectionCatalogItem(type=progress) and
 * CalendarCatalogItem(type=eventType) with a single comparable ordering,
 * used both by the collection rows' production status and by the calendar.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { PhaseInputSchema, PhaseInputBaseSchema, partialWithoutDefaults } from '@luke/core';


import { logAudit } from '../lib/auditLog';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';

/** Derives the display code from position: order 0 → "01", order 1 → "02", ... */
function codeForOrder(order: number): string {
  return String(order + 1).padStart(2, '0');
}

/** Open row, reduced to the context needed in the guard's error message. */
/** Open rows on a phase, already aggregated per layout: `{ brand/season code → count }`. */
type OpenRowsByScope = { scope: string; count: number }[];

/**
 * Message for `remove`'s guard: says how many rows are still open and **where** (brand/season),
 * plus how many milestones still reference the phase. A "phase in use" without coordinates would
 * leave the admin searching for them by hand across every layout.
 */
function describePhaseInUse(openRows: OpenRowsByScope, plannedEvents: number): string {
  const parts: string[] = [];

  const openCount = openRows.reduce((sum, r) => sum + r.count, 0);
  if (openCount > 0) {
    const breakdown = [...openRows]
      .sort((a, b) => a.scope.localeCompare(b.scope))
      .map(({ scope, count }) => `${scope}: ${count}`)
      .join(', ');
    parts.push(`${openCount} righe ancora aperte (${breakdown})`);
  }

  if (plannedEvents > 0) {
    parts.push(`${plannedEvents} milestone di calendario`);
  }

  return `Fase ancora in uso: ${parts.join(' e ')}. Concludi o sposta le righe, e cancella le milestone, prima di ritirarla.`;
}

export const phaseRouter = router({
  /**
   * Lists active phases, used to populate frontend selects.
   *
   * `includeInactive` exists to resolve historical **labels**, not to populate pickers: a
   * retired phase stays referenced by the rows that passed through it, and without it the drawer
   * would show `Current phase: —` on data that actually exists. Consumers must keep filtering
   * on `isActive` for the selectable options (see `usePhaseCatalog`).
   *
   * Distinct from `listAll`, which serves catalog management and requires the write permission.
   *
   * @auth {phase_catalog:read}
   * @input {{ includeInactive?: boolean }} — optional, default: active only.
   * @output {Phase[]} — sorted by order.
   */
  list: protectedProcedure
    .use(requirePermission('phase_catalog:read'))
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ input, ctx }) => {
      return ctx.prisma.phase.findMany({
        where: input?.includeInactive ? {} : { isActive: true },
        orderBy: { order: 'asc' },
      });
    }),

  /**
   * Lists all phases including inactive ones, for admin management.
   *
   * @auth {phase_catalog:update}
   * @input {none}
   * @output {Phase[]} — all phases sorted by order.
   */
  listAll: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .query(async ({ ctx }) => {
      return ctx.prisma.phase.findMany({
        orderBy: { order: 'asc' },
      });
    }),

  /**
   * Creates a new phase.
   *
   * @auth {phase_catalog:update}
   * @input {PhaseInputSchema} — value (unique), label, optional order. `code` is derived from order, not client-settable.
   * @output {Phase} — the newly created phase.
   */
  create: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(PhaseInputSchema)
    .mutation(async ({ input, ctx }) => {
      const existing = await ctx.prisma.phase.findUnique({
        where: { value: input.value },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `Il valore '${input.value}' esiste già`,
        });
      }

      const maxOrder = await ctx.prisma.phase.aggregate({
        _max: { order: true },
      });
      const order = input.order ?? (maxOrder._max.order ?? -1) + 1;

      const result = await ctx.prisma.phase.create({
        data: {
          value: input.value,
          label: input.label,
          code: codeForOrder(order),
          order,
        },
      });

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_CREATE',
        targetType: 'Phase',
        targetId: result.id,
        result: 'SUCCESS',
        metadata: { value: input.value },
      });

      return result;
    }),

  /**
   * Updates mutable fields of a phase (label, order). `code` is re-derived from order automatically.
   *
   * @auth {phase_catalog:update}
   * @input {{ id: string, data: Partial<PhaseInputBaseSchema without value> }}
   * @output {Phase} — the updated phase.
   */
  update: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(
      z.object({
        id: z.string().uuid(),
        data: partialWithoutDefaults(PhaseInputBaseSchema.omit({ value: true })),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.phase.findUnique({ where: { id: input.id } });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fase non trovata' });
      }

      const order = input.data.order ?? item.order;

      const result = await ctx.prisma.phase.update({
        where: { id: input.id },
        data: { ...input.data, code: codeForOrder(order) },
      });

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_UPDATE',
        targetType: 'Phase',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { label: result.label, value: result.value, code: result.code, changedFields: Object.keys(input.data) },
      });

      return result;
    }),

  /**
   * Soft-deletes a phase (isActive=false).
   *
   * Rejects while the phase is still in use, because deactivating it isn't a neutral operation for
   * the alert engine: a retired phase stops being measured, so rows sitting on it would silently
   * drop out of badges, dashboards, and overdue notifications, and milestones left on that phase
   * would stay in the calendars, shifting which deadline is active. "In use"
   * means two things, both blocking:
   *   - collection layout rows still **open** (`completedAt` null) on that phase. Concluded rows
   *     don't count: they've already stopped being measured, which is what makes it possible to
   *     retire a phase that worked fine in past seasons without having to archive those seasons.
   *   - uncancelled calendar events that reference it.
   *
   * @auth {phase_catalog:update}
   * @input {{ id: string }} — UUID of the phase to deactivate.
   * @output {{ success: true }}
   * @throws CONFLICT — with counts and breakdown per brand/season, so the admin knows where to act.
   */
  remove: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.phase.findUnique({ where: { id: input.id } });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fase non trovata' });
      }

      // Independent reads: the event count doesn't depend on the rows found.
      // Rows are counted aggregated per layout instead of loading them: a catalog phase is
      // referenced by every brand × season, so materializing all of them to build a
      // string would mean reading thousands of rows on every retirement attempt.
      const [rowsPerLayout, plannedEvents] = await Promise.all([
        ctx.prisma.collectionLayoutRow.groupBy({
          by: ['collectionLayoutId'],
          where: { phaseId: input.id, completedAt: null },
          _count: { _all: true },
        }),
        ctx.prisma.calendarEvent.count({ where: { phaseId: input.id, cancelledAt: null } }),
      ]);

      if (rowsPerLayout.length > 0 || plannedEvents > 0) {
        // Only the involved layouts, not all of them: needed to translate the ids into brand/season codes.
        const layouts = await ctx.prisma.collectionLayout.findMany({
          where: { id: { in: rowsPerLayout.map(r => r.collectionLayoutId) } },
          select: { id: true, brand: { select: { code: true } }, season: { select: { code: true } } },
        });
        const scopeById = new Map(layouts.map(l => [l.id, `${l.brand.code}/${l.season.code}`]));

        throw new TRPCError({
          code: 'CONFLICT',
          message: describePhaseInUse(
            rowsPerLayout.map(r => ({
              scope: scopeById.get(r.collectionLayoutId) ?? r.collectionLayoutId,
              count: r._count._all,
            })),
            plannedEvents
          ),
        });
      }

      await ctx.prisma.phase.update({
        where: { id: input.id },
        data: { isActive: false },
      });

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_REMOVE',
        targetType: 'Phase',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { value: item.value },
      });

      return { success: true };
    }),

  /**
   * Restores a soft-deleted phase (isActive=true).
   *
   * @auth {phase_catalog:update}
   * @input {{ id: string }} — UUID of the phase to restore.
   * @output {{ success: true }}
   */
  restore: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.phase.findUnique({ where: { id: input.id } });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fase non trovata' });
      }

      await ctx.prisma.phase.update({
        where: { id: input.id },
        data: { isActive: true },
      });

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_RESTORE',
        targetType: 'Phase',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { value: item.value },
      });

      return { success: true };
    }),

  /**
   * Reorders phases by assigning new position indices.
   *
   * @auth {phase_catalog:update}
   * @input {{ orderedIds: string[] }} — full ordered array of UUIDs.
   * @output {{ success: true }}
   */
  reorder: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ orderedIds: z.array(z.string().uuid()) }))
    .mutation(async ({ input, ctx }) => {
      await ctx.prisma.$transaction(
        input.orderedIds.map((id, index) =>
          ctx.prisma.phase.update({
            where: { id },
            data: { order: index, code: codeForOrder(index) },
          })
        )
      );

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_REORDER',
        targetType: 'Phase',
        targetId: 'phase_catalog',
        result: 'SUCCESS',
        metadata: { count: input.orderedIds.length },
      });

      return { success: true };
    }),
});
