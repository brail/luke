/**
 * Router tRPC per lo storico transizioni di fase (CollectionRowPhaseHistory).
 * Query aggregate usate dalla dashboard di stagnazione predittiva (Fase 6.3).
 */

import { z } from 'zod';

import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';

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
   *   endpoint was added in Fase 4. The Fase 6.3 stagnation dashboard page sits behind the
   *   `product.controllo` section (gated by `collection_alert:read`), so a role could see the page
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
          const days = (next.reachedAt.getTime() - current.reachedAt.getTime()) / 86_400_000;
          const bucket = durationsByPhase.get(current.phaseId) ?? { label: current.phase.label, days: [] };
          bucket.days.push(days);
          durationsByPhase.set(current.phaseId, bucket);
        }
      }

      return Array.from(durationsByPhase.entries()).map(([phaseId, { label, days }]) => {
        const sorted = [...days].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
        return {
          phaseId,
          phaseLabel: label,
          avgDays: Math.round((days.reduce((s, d) => s + d, 0) / days.length) * 10) / 10,
          medianDays: Math.round(median * 10) / 10,
          sampleCount: days.length,
        };
      });
    }),
});
