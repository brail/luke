/**
 * tRPC router for the alert engine (Phase 5). On-demand computation, no persisted results.
 * Aggregate queries per layout/brand used by the saturation dashboard (Phase 6.1/6.2).
 */

import { z } from 'zod';

import { CollectionAlertThresholdsSchema } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { saveConfig } from '../lib/configManager';
import { requirePermission } from '../lib/permissions';
import { router, protectedProcedure } from '../lib/trpc';
import {
  filterAllowedBrandIds,
  resolveLayoutBrandAccess,
  resolveRowBrandAccess,
} from '../services/brandScope.service';
import {
  computeBottleneckByEvent,
  computeCriticality,
  computeCriticalityForLayout,
  computeSaturationHeatmap,
  computeSeasonPhaseOrder,
  resolveAlertThresholds,
  resolveMissingPhasesForRow,
} from '../services/phaseAlert.service';
import { maskBottleneck, maskCriticality, maskCriticalityList } from '../services/phaseAlertVisibility.service';

export const phaseAlertRouter = router({
  /**
   * Criticality band for a single row against its active phase deadline.
   *
   * @auth {collection_alert:read}
   * @input {{ rowId: string }}
   * @output {{ state: 'active', rowId, eventId, eventTitle, eventStartDay, phaseId, deadlineDay,
   *   daysToDeadline, reached, daysMode, relevantCountryCodes, band, nextPhase }
   *   | { state: 'completed', rowId, completedDay, eventHidden, eventId, eventTitle, deadlineDay, daysVsDeadline, late,
   *   daysMode, relevantCountryCodes, band } | null} — counts in the business time zone;
   *   `reached`/`late` decide lateness, the count stays real; `deadlineDay`/`eventStartDay` are
   *   calendar dates — an all-day event's own, a timed one's in that zone, `null` with the event's
   *   identity and day counts for an event the caller cannot list — and `completedDay` is
   *   the completion's day in that zone.
   */
  criticalityForRow: protectedProcedure
    .use(requirePermission('collection_alert:read'))
    .input(z.object({ rowId: z.uuid() }))
    .query(async ({ input, ctx }) => {
      await resolveRowBrandAccess(ctx, input.rowId);
      return maskCriticality(ctx, await computeCriticality(input.rowId, new Date(), ctx.prisma));
    }),

  /**
   * Phases the row hasn't passed through, to show before concluding it. Empty when the row is
   * already at the last milestone planned for its group: in that case concluding skips nothing.
   *
   * Preview, not a guard: the same list is recomputed by `collectionLayout.rows.setCompleted`,
   * which is the point where forcing is required and recorded. It serves the UI to say *which*
   * phases are missing before the user confirms, instead of finding out from an error.
   *
   * @auth {collection_layout:update} — not `collection_alert:read`: this only matters to whoever
   *   can conclude, and aligning it with the mutation's permission keeps the two from diverging.
   * @input {{ rowId: string }}
   * @output {{ missingPhases: { value: string, label: string }[] }}
   */
  completionPreview: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .input(z.object({ rowId: z.uuid() }))
    .query(async ({ input, ctx }) => {
      await resolveRowBrandAccess(ctx, input.rowId);
      return { missingPhases: await resolveMissingPhasesForRow(input.rowId, ctx.prisma) };
    }),

  /**
   * Criticality band for every row in a layout — the building block for the saturation heatmap
   * (Phase 6.1) and the bottleneck index (Phase 6.2).
   *
   * @auth {collection_alert:read}
   * @input {{ collectionLayoutId: string }}
   * @output {Array<same union as `criticalityForRow`, plus productCategory>} — rows with no active
   *   phase (not yet frozen calendar / all phases completed) are omitted.
   */
  criticalityForLayout: protectedProcedure
    .use(requirePermission('collection_alert:read'))
    .input(z.object({ collectionLayoutId: z.uuid() }))
    .query(async ({ input, ctx }) => {
      await resolveLayoutBrandAccess(ctx, input.collectionLayoutId);
      return maskCriticalityList(ctx, await computeCriticalityForLayout(input.collectionLayoutId, new Date(), ctx.prisma));
    }),

  /**
   * Returns the currently configured (or default) alert thresholds — for admin display/edit UIs.
   *
   * @auth {collection_alert:read}
   * @input {none}
   * @output {CollectionAlertThresholds}
   */
  thresholds: protectedProcedure
    .use(requirePermission('collection_alert:read'))
    .query(async ({ ctx }) => {
      return resolveAlertThresholds(ctx.prisma);
    }),

  /**
   * Overwrites `collectionControl.alertThresholds` — the admin-configured criticality bands
   * consumed by `resolveAlertThresholds`. Same `config:update` gate as the other AppConfig-backed
   * settings pages (mail/ldap/storage), not `collection_alert:*` — `COLLECTION_ALERT` only grants
   * `read` in `VALID_RESOURCE_ACTIONS`, and this is config administration, not alert-engine usage.
   *
   * @auth {config:update}
   * @input {CollectionAlertThresholdsSchema} — default bands + optional per-Phase overrides.
   * @output {{ success: true }}
   */
  updateThresholds: protectedProcedure
    .use(requirePermission('config:update'))
    .input(CollectionAlertThresholdsSchema)
    .mutation(async ({ input, ctx }) => {
      await saveConfig(ctx.prisma, 'collectionControl.alertThresholds', JSON.stringify(input), false);

      await logAudit(ctx, {
        action: 'CONFIG_UPSERT',
        targetType: 'Config',
        targetId: 'collectionControl.alertThresholds',
        result: 'SUCCESS',
        metadata: {
          bandCount: input.default.bands.length,
          overriddenPhases: Object.keys(input.perPhaseOverride ?? {}),
        },
      });

      return { success: true };
    }),

  /**
   * Saturation heatmap (Phase 6.1): row counts per criticality band, grouped by brand and
   * product category, across the requested brands' layouts for the given season. Brands outside the
   * caller's scope are dropped, as in a filterable view (`seasonCalendar.listMilestones`).
   *
   * @auth {collection_alert:read}
   * @input {{ seasonId: string, brandIds: string[] }} — at most 100, the page's `brand.list` limit.
   * @output {{ brandId, productCategory, label, color, emphasis, count }[]}
   */
  saturationHeatmap: protectedProcedure
    .use(requirePermission('collection_alert:read'))
    .input(z.object({ seasonId: z.uuid(), brandIds: z.array(z.uuid()).min(1).max(100) }))
    .query(async ({ input, ctx }) => {
      const brandIds = await filterAllowedBrandIds(ctx, input.brandIds);
      if (brandIds.length === 0) return [];
      return computeSaturationHeatmap(input.seasonId, brandIds, new Date(), ctx.prisma);
    }),

  /**
   * Bottleneck index (Phase 6.2): row counts per criticality band, grouped by active event —
   * identifies which milestone is holding up the most rows in a layout.
   *
   * @auth {collection_alert:read}
   * @input {{ collectionLayoutId: string }}
   * @output {{ eventId, eventTitle, eventStartDay, bands: { label, color, emphasis, count }[] }[]} — the events
   *   the caller cannot list merged into one last entry with `null` fields, the others sorted by
   *   eventStartDay (a calendar date, as for `criticalityForRow`), then title and id.
   */
  bottleneckByEvent: protectedProcedure
    .use(requirePermission('collection_alert:read'))
    .input(z.object({ collectionLayoutId: z.uuid() }))
    .query(async ({ input, ctx }) => {
      await resolveLayoutBrandAccess(ctx, input.collectionLayoutId);
      return maskBottleneck(ctx, await computeBottleneckByEvent(input.collectionLayoutId, new Date(), ctx.prisma));
    }),

  /**
   * The phases a layout's season calendar plans, in season order (#159): each phase by its earliest
   * deadline in any planning group. Phase ids only — no event is named.
   *
   * @auth {collection_alert:read}
   * @input {{ collectionLayoutId: string }}
   * @output {string[]} — phase ids; phases no group plans are left out.
   */
  seasonPhaseOrder: protectedProcedure
    .use(requirePermission('collection_alert:read'))
    .input(z.object({ collectionLayoutId: z.uuid() }))
    .query(async ({ input, ctx }) => {
      await resolveLayoutBrandAccess(ctx, input.collectionLayoutId);
      return computeSeasonPhaseOrder(input.collectionLayoutId, ctx.prisma);
    }),
});
