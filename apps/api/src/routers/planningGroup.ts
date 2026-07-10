/**
 * tRPC router for PlanningGroup CRUD (create/list/rename/delete).
 *
 * A PlanningGroup scopes both CalendarEvents and CollectionLayoutRows within a SeasonCalendar — an
 * event applies to exactly the rows sharing its planningGroupId. Every calendar has one default
 * group (auto-created, never renamed/deleted); this router manages the rest.
 *
 * Freeze/unfreeze and template application on a group live in `seasonCalendar.ts` (they mutate
 * CalendarEvents, not the group's own identity).
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { PlanningGroupInputSchema } from '@luke/core';

import { logAudit } from '../lib/auditLog.js';
import { requirePermission } from '../lib/permissions.js';
import { withRateLimit } from '../lib/ratelimit.js';
import { router, protectedProcedure } from '../lib/trpc.js';
import {
  assertBrandAccess,
  resolvePlanningGroupWithBrandAccess,
  getOrCreateCalendar,
  createPlanningGroup,
  listPlanningGroups,
  renamePlanningGroup,
  deletePlanningGroup,
} from '../services/seasonCalendar.service.js';

export const planningGroupRouter = router({
  /**
   * Lists the planning groups of a brand+season's calendar (creating the calendar and its default
   * group if they don't exist yet).
   *
   * @auth season_calendar:read
   * @input { brandId, seasonId }
   * @output Array of PlanningGroup records (default first, then alphabetical), with row/event counts
   */
  list: protectedProcedure
    .use(requirePermission('season_calendar:read'))
    .input(z.object({ brandId: z.string().uuid(), seasonId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      await assertBrandAccess(ctx.session.user.id, input.brandId, ctx.prisma);
      const calendar = await getOrCreateCalendar(input.brandId, input.seasonId, ctx.prisma);
      return listPlanningGroups(calendar.id, ctx.prisma);
    }),

  /**
   * Creates a new (non-default) planning group within a calendar.
   *
   * @auth season_calendar:update
   * @input { calendarId, name }
   * @output The created PlanningGroup
   */
  create: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ calendarId: z.string().uuid() }).and(PlanningGroupInputSchema))
    .mutation(async ({ input, ctx }) => {
      const calendar = await ctx.prisma.seasonCalendar.findUnique({
        where: { id: input.calendarId },
        select: { brandId: true },
      });
      if (!calendar) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
      await assertBrandAccess(ctx.session.user.id, calendar.brandId, ctx.prisma);

      const result = await createPlanningGroup(input.calendarId, input.name, ctx.prisma);
      await logAudit(ctx, { action: 'PLANNING_GROUP_CREATE', targetType: 'PlanningGroup', targetId: result.id, result: 'SUCCESS', metadata: { name: result.name } });
      return result;
    }),

  /**
   * Renames a planning group. The default group cannot be renamed.
   *
   * @auth season_calendar:update
   * @input { id, name }
   * @output The updated PlanningGroup
   */
  rename: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }).and(PlanningGroupInputSchema))
    .mutation(async ({ input, ctx }) => {
      await resolvePlanningGroupWithBrandAccess(input.id, ctx.session.user.id, ctx.prisma);

      const result = await renamePlanningGroup(input.id, input.name, ctx.prisma);
      await logAudit(ctx, { action: 'PLANNING_GROUP_RENAME', targetType: 'PlanningGroup', targetId: input.id, result: 'SUCCESS', metadata: { name: input.name } });
      return result;
    }),

  /**
   * Deletes a planning group. The default group, or a group still owning events/rows, cannot be
   * deleted — reassign them to another group first.
   *
   * @auth season_calendar:update
   * @input { id }
   * @output { success: true }
   */
  delete: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await resolvePlanningGroupWithBrandAccess(input.id, ctx.session.user.id, ctx.prisma);

      await deletePlanningGroup(input.id, ctx.prisma);
      await logAudit(ctx, { action: 'PLANNING_GROUP_DELETE', targetType: 'PlanningGroup', targetId: input.id, result: 'SUCCESS', metadata: {} });
      return { success: true };
    }),
});
