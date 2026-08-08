/**
 * tRPC router for the phase transition history (CollectionRowPhaseHistory).
 * Aggregate queries used by the predictive stagnation dashboard (Phase 6.3).
 */

import { z } from 'zod';

import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';
import {
  resolveLayoutBrandAccess,
  resolveRowBrandAccess,
} from '../services/brandScope.service';

/** Milliseconds in a day: durations here stay fractional (average to one decimal), so
 * they don't go through `daysBetween`, which rounds to whole UTC days. */
const MS_PER_DAY = 86_400_000;

/**
 * Average, median, and sample size of a set of durations in days — the statistical contract
 * shared by this router's two aggregate reads (per phase and up to conclusion),
 * so that rounding and the even-median rule can't diverge between the two.
 *
 * @returns Average and median `null` on an empty sample: no data isn't zero days.
 */
function summarizeDays(days: number[]): { avgDays: number | null; medianDays: number | null; sampleCount: number } {
  if (days.length === 0) return { avgDays: null, medianDays: null, sampleCount: 0 };

  const sorted = [...days].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];

  return {
    avgDays: Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10,
    medianDays: Math.round(median * 10) / 10,
    sampleCount: days.length,
  };
}

export const phaseHistoryRouter = router({
  /**
   * Lists the full phase transition history for a single row, oldest first.
   *
   * @auth {collection_layout:read}
   * @input {{ rowId: string }}
   * @output {CollectionRowPhaseHistory[]} — entries with phase relation, ordered by reachedAt asc.
   */
  listForRow: protectedProcedure
    .use(requirePermission('collection_layout:read'))
    .input(z.object({ rowId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await resolveRowBrandAccess(ctx, input.rowId);

      return ctx.prisma.collectionRowPhaseHistory.findMany({
        where: { rowId: input.rowId },
        include: { phase: { select: { id: true, value: true, label: true, code: true, order: true } } },
        orderBy: { reachedAt: 'asc' },
      });
    }),

  /**
   * Average and median dwell time (in days) per phase, computed from consecutive history entries
   * for every row in the given layout. A row's most recent transition has no dwell time yet
   * (still in that phase) and is excluded from the average.
   *
   * @auth {collection_layout:read} — intentionally not `collection_alert:read`, same as when this
   *   endpoint was added in Phase 4. The Phase 6.3 stagnation dashboard page sits behind the
   *   `product.control` section (gated by `collection_alert:read`), so a role could see the page
   *   shell without this query succeeding (or vice versa) if the two permissions are ever granted
   *   differently via the AppConfig runtime override. Today both are granted identically to every
   *   role's defaults, so this is a latent, not active, divergence.
   * @input {{ collectionLayoutId: string }}
   * @output {{ phaseId: string, phaseLabel: string, avgDays: number, medianDays: number, sampleCount: number }[]}
   */
  layoutStats: protectedProcedure
    .use(requirePermission('collection_layout:read'))
    .input(z.object({ collectionLayoutId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await resolveLayoutBrandAccess(ctx, input.collectionLayoutId);

      const entries = await ctx.prisma.collectionRowPhaseHistory.findMany({
        where: { row: { collectionLayoutId: input.collectionLayoutId } },
        select: {
          rowId: true,
          reachedAt: true,
          phaseId: true,
          phase: { select: { label: true } },
        },
        orderBy: [{ rowId: 'asc' }, { reachedAt: 'asc' }],
      });

      const durationsByPhase = new Map<string, { label: string; days: number[] }>();

      // Entries are sorted by rowId then reachedAt, so consecutive entries with the same rowId
      // are the row's phase transitions in order — no need to group into per-row buckets first.
      for (let k = 0; k < entries.length; k++) {
        const current = entries[k];
        const next = entries[k + 1];
        if (next && next.rowId === current.rowId) {
          const days = (next.reachedAt.getTime() - current.reachedAt.getTime()) / MS_PER_DAY;
          const bucket = durationsByPhase.get(current.phaseId) ?? { label: current.phase.label, days: [] };
          bucket.days.push(days);
          durationsByPhase.set(current.phaseId, bucket);
        }
      }

      return Array.from(durationsByPhase.entries()).map(([phaseId, { label, days }]) => {
        // `durationsByPhase` never has empty buckets (a phase is only added when it has a duration),
        // so average and median are never null here.
        const { avgDays, medianDays, sampleCount } = summarizeDays(days);
        return { phaseId, phaseLabel: label, avgDays: avgDays!, medianDays: medianDays!, sampleCount };
      });
    }),

  /**
   * Total lead time (in days) of the concluded rows in a layout: from a row's first recorded phase
   * transition to the moment it was marked as concluded. Complements `layoutStats`, which measures
   * how long rows sit inside each phase but can never measure the end — the last phase has no
   * following transition to close it. Rows still in progress, or concluded without any recorded
   * transition to start counting from, are excluded.
   *
   * @auth {collection_layout:read} — same permission (and same latent divergence) as `layoutStats`.
   * @input {{ collectionLayoutId: string }}
   * @output {{ avgDays: number | null, medianDays: number | null, sampleCount: number }} — nulls
   *   when no concluded row has a usable baseline.
   */
  completionLeadTime: protectedProcedure
    .use(requirePermission('collection_layout:read'))
    .input(z.object({ collectionLayoutId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await resolveLayoutBrandAccess(ctx, input.collectionLayoutId);

      // The two reads filter on the same set of rows (the groupBy goes through the relation
      // instead of an `IN` on the just-read ids), so they're independent and run together.
      // `completedAt` is filtered but deliberately not indexed: it never appears without
      // `collectionLayoutId`, which is, and a layout's rows are few — an index would only
      // cost on writes.
      const rowScope = { collectionLayoutId: input.collectionLayoutId, completedAt: { not: null } } as const;
      const [rows, firstTransitions] = await Promise.all([
        ctx.prisma.collectionLayoutRow.findMany({
          where: rowScope,
          select: { id: true, completedAt: true },
        }),
        ctx.prisma.collectionRowPhaseHistory.groupBy({
          by: ['rowId'],
          where: { row: rowScope },
          _min: { reachedAt: true },
        }),
      ]);
      const startByRowId = new Map(firstTransitions.map(t => [t.rowId, t._min.reachedAt]));

      const days = rows.flatMap(row => {
        const start = startByRowId.get(row.id);
        if (!start || !row.completedAt) return [];
        return [(row.completedAt.getTime() - start.getTime()) / MS_PER_DAY];
      });

      return summarizeDays(days);
    }),
});
