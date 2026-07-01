/**
 * Router tRPC per il motore di alert (Fase 5). Calcolo on-demand, nessun risultato persistito.
 * Query aggregate per layout/brand usate dalla dashboard di saturazione (Fase 6.1/6.2).
 */

import { z } from 'zod';

import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';
import {
  computeBottleneckByEvent,
  computeCriticality,
  computeCriticalityForLayout,
  computeSaturationHeatmap,
  computeSchedulingVariance,
  resolveAlertThresholds,
} from '../services/phaseAlert.service';

export const phaseAlertRouter = router({
  /**
   * Criticality band for a single row against its active phase deadline.
   *
   * @auth {collection_alert:read}
   * @input {{ rowId: string }}
   * @output {{ rowId, eventId, phaseId, deadline, daysToDeadline, band } | null}
   */
  criticalityForRow: protectedProcedure
    .use(requirePermission('collection_alert:read'))
    .input(z.object({ rowId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return computeCriticality(input.rowId, new Date(), ctx.prisma);
    }),

  /**
   * Plan-vs-actual scheduling variance for a row's current phase (baseline vs CollectionRowPhaseHistory).
   *
   * @auth {collection_alert:read}
   * @input {{ rowId: string }}
   * @output {{ rowId, phaseId, plannedDate, actualDate, varianceDays } | null}
   */
  schedulingVarianceForRow: protectedProcedure
    .use(requirePermission('collection_alert:read'))
    .input(z.object({ rowId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return computeSchedulingVariance(input.rowId, ctx.prisma);
    }),

  /**
   * Criticality band for every row in a layout — the building block for the saturation heatmap
   * (Fase 6.1) and the bottleneck index (Fase 6.2).
   *
   * @auth {collection_alert:read}
   * @input {{ collectionLayoutId: string }}
   * @output {{ rowId, eventId, phaseId, deadline, daysToDeadline, band }[]} — rows with no active
   *   phase (not yet frozen calendar / all phases completed) are omitted.
   */
  criticalityForLayout: protectedProcedure
    .use(requirePermission('collection_alert:read'))
    .input(z.object({ collectionLayoutId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return computeCriticalityForLayout(input.collectionLayoutId, new Date(), ctx.prisma);
    }),

  /**
   * Returns the currently configured (or default) alert thresholds — for admin display/edit UIs.
   *
   * @auth {collection_alert:read}
   * @output {CollectionAlertThresholds}
   */
  thresholds: protectedProcedure
    .use(requirePermission('collection_alert:read'))
    .query(async ({ ctx }) => {
      return resolveAlertThresholds(ctx.prisma);
    }),

  /**
   * Saturation heatmap (Fase 6.1): row counts per criticality band, grouped by brand and
   * product category, across every brand's layout for the given season.
   *
   * @auth {collection_alert:read}
   * @input {{ seasonId: string, brandIds: string[] }}
   * @output {{ brandId, productCategory, label, color, count }[]}
   */
  saturationHeatmap: protectedProcedure
    .use(requirePermission('collection_alert:read'))
    .input(z.object({ seasonId: z.string().uuid(), brandIds: z.array(z.string().uuid()).min(1) }))
    .query(async ({ input, ctx }) => {
      return computeSaturationHeatmap(input.seasonId, input.brandIds, new Date(), ctx.prisma);
    }),

  /**
   * Bottleneck index (Fase 6.2): row counts per criticality band, grouped by active event —
   * identifies which milestone is holding up the most rows in a layout.
   *
   * @auth {collection_alert:read}
   * @input {{ collectionLayoutId: string }}
   * @output {{ eventId, eventTitle, eventStartAt, bands: { label, color, count }[] }[]} — sorted by eventStartAt.
   */
  bottleneckByEvent: protectedProcedure
    .use(requirePermission('collection_alert:read'))
    .input(z.object({ collectionLayoutId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      return computeBottleneckByEvent(input.collectionLayoutId, new Date(), ctx.prisma);
    }),
});
