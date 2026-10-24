/**
 * tRPC router for the unified Phase catalog, used both by the collection rows' production status
 * and by the calendar. The catalog holds no order: a planning group's phases are ordered by their
 * events' deadlines (#159, `groupRanker`), so the catalog lists alphabetically.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { PhaseInputSchema, PhaseInputBaseSchema, partialWithoutDefaults } from '@luke/core';


import { logAudit } from '../lib/auditLog';
import { requirePermission } from '../lib/permissions';
import { withRateLimit } from '../lib/ratelimit';
import { router, protectedProcedure } from '../lib/trpc';

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
   * @output {Phase[]} — by label, then id.
   */
  list: protectedProcedure
    .use(requirePermission('phase_catalog:read'))
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ input, ctx }) => {
      return ctx.prisma.phase.findMany({
        where: input?.includeInactive ? {} : { isActive: true },
        orderBy: [{ label: 'asc' }, { id: 'asc' }],
      });
    }),

  /**
   * Lists all phases including inactive ones, for admin management.
   *
   * @auth {phase_catalog:update}
   * @input {none}
   * @output {Phase[]} — all phases, by label, then id.
   */
  listAll: protectedProcedure
    .use(requirePermission('phase_catalog:update'))
    .query(async ({ ctx }) => {
      return ctx.prisma.phase.findMany({
        orderBy: [{ label: 'asc' }, { id: 'asc' }],
      });
    }),

  /**
   * Creates a new phase.
   *
   * @auth {phase_catalog:update}
   * @input {PhaseInputSchema} — value (unique), label, optional description, durationDays and color.
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

      const result = await ctx.prisma.phase.create({
        data: {
          value: input.value,
          label: input.label,
          description: input.description,
          durationDays: input.durationDays,
          color: input.color,
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
   * Updates mutable fields of a phase (label, description, durationDays, color).
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
        id: z.uuid(),
        data: partialWithoutDefaults(PhaseInputBaseSchema.omit({ value: true })),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const item = await ctx.prisma.phase.findUnique({ where: { id: input.id } });
      if (!item) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Fase non trovata' });
      }

      const result = await ctx.prisma.phase.update({
        where: { id: input.id },
        data: input.data,
      });

      // The edit dialog sends every field: only those whose value differs were changed. Cast:
      // `Object.keys` types its keys as plain strings, and these are the input's own.
      const changedFields = (Object.keys(input.data) as (keyof typeof input.data)[]).filter(key => input.data[key] !== item[key]);

      await logAudit(ctx, {
        action: 'PHASE_CATALOG_UPDATE',
        targetType: 'Phase',
        targetId: input.id,
        result: 'SUCCESS',
        metadata: { label: result.label, value: result.value, changedFields },
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
    .input(z.object({ id: z.uuid() }))
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
    .input(z.object({ id: z.uuid() }))
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
});
