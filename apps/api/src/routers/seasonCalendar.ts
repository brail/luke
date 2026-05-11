import { z } from 'zod';
import { TRPCError } from '@trpc/server';

import {
  CalendarMilestoneInputSchema,
  CalendarMilestoneBaseSchema,
  CloneSeasonCalendarInputSchema,
  MilestonePersonalNoteInputSchema,
  PLANNING_SECTION_KEYS,
  SEASON_CALENDAR_STATUS,
  CALENDAR_MILESTONE_STATUS,
  CALENDAR_MILESTONE_TYPE,
} from '@luke/core';

import { logAudit } from '../lib/auditLog.js';
import { withRateLimit } from '../lib/ratelimit.js';
import { router, protectedProcedure } from '../lib/trpc.js';
import { requirePermission } from '../lib/permissions.js';
import {
  syncOneMilestone,
  cleanupMilestoneEvents,
  reconcileCalendar,
} from '../services/googleCalendarSync.service.js';

import {
  assertBrandAccess,
  filterAllowedBrandIds,
  getOrCreateCalendar,
  updateCalendarStatus,
  setAnchorDate,
  listMilestonesDb,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  upsertNote,
  deleteNote,
  listTemplates,
  applyTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  createTemplateItem,
  updateTemplateItem,
  deleteTemplateItem,
  cloneFromBrandSeason,
  getSyncStatus,
} from '../services/seasonCalendar.service.js';

export const seasonCalendarRouter = router({
  // ─── Calendar management ────────────────────────────────────────────────────

  getOrCreate: protectedProcedure
    .use(requirePermission('season_calendar:read'))
    .input(z.object({
      brandId: z.string().uuid(),
      seasonId: z.string().uuid(),
    }))
    .query(async ({ input, ctx }) => {
      await assertBrandAccess(ctx.session.user.id, input.brandId, ctx.prisma);
      return getOrCreateCalendar(input.brandId, input.seasonId, ctx.prisma);
    }),

  updateStatus: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({
      calendarId: z.string().uuid(),
      status: z.enum(SEASON_CALENDAR_STATUS),
    }))
    .mutation(async ({ input, ctx }) => {
      const calendar = await ctx.prisma.seasonCalendar.findUnique({
        where: { id: input.calendarId },
        select: { brandId: true },
      });
      if (!calendar) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
      await assertBrandAccess(ctx.session.user.id, calendar.brandId, ctx.prisma);
      const result = await updateCalendarStatus(input.calendarId, input.status, ctx.prisma);
      await logAudit(ctx, { action: 'SEASON_CALENDAR_STATUS_UPDATE', targetType: 'SeasonCalendar', targetId: input.calendarId, result: 'SUCCESS', metadata: { status: input.status } });
      return result;
    }),

  setAnchorDate: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({
      calendarId: z.string().uuid(),
      anchorDate: z.string().datetime(),
    }))
    .mutation(async ({ input, ctx }) => {
      const calendar = await ctx.prisma.seasonCalendar.findUnique({
        where: { id: input.calendarId },
        select: { brandId: true },
      });
      if (!calendar) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
      await assertBrandAccess(ctx.session.user.id, calendar.brandId, ctx.prisma);
      const result = await setAnchorDate(input.calendarId, new Date(input.anchorDate), ctx.prisma);
      await logAudit(ctx, { action: 'SEASON_CALENDAR_ANCHOR_SET', targetType: 'SeasonCalendar', targetId: input.calendarId, result: 'SUCCESS', metadata: {} });
      return result;
    }),

  // ─── Milestone queries ──────────────────────────────────────────────────────

  listMilestones: protectedProcedure
    .use(requirePermission('season_calendar:read'))
    .input(z.object({
      seasonId: z.string().uuid(),
      brandIds: z.array(z.string().uuid()).min(1),
      sectionKey: z.enum(PLANNING_SECTION_KEYS).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const allowedBrandIds = await filterAllowedBrandIds(
        ctx.session.user.id,
        input.brandIds,
        ctx.prisma
      );
      if (allowedBrandIds.length === 0) return [];
      return listMilestonesDb(input.seasonId, allowedBrandIds, ctx.session.user.id, ctx.prisma, input.sectionKey);
    }),

  // ─── Milestone mutations ────────────────────────────────────────────────────

  createMilestone: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(CalendarMilestoneInputSchema)
    .mutation(async ({ input, ctx }) => {
      const calendar = await ctx.prisma.seasonCalendar.findUnique({
        where: { id: input.calendarId },
        select: { brandId: true },
      });
      if (!calendar) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
      await assertBrandAccess(ctx.session.user.id, calendar.brandId, ctx.prisma);

      const result = await createMilestone(input, ctx.prisma);
      await logAudit(ctx, { action: 'CALENDAR_MILESTONE_CREATE', targetType: 'CalendarMilestone', targetId: result.id, result: 'SUCCESS', metadata: { calendarId: input.calendarId, ownerSectionKey: input.ownerSectionKey } });
      syncOneMilestone(result.id, ctx.prisma, ctx.logger).catch(err => ctx.logger.error(err, 'gcal sync failed on create'));
      return result;
    }),

  updateMilestone: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({
      id: z.string().uuid(),
      data: CalendarMilestoneBaseSchema.partial().omit({ calendarId: true }),
    }))
    .mutation(async ({ input, ctx }) => {
      const milestone = await ctx.prisma.calendarMilestone.findUnique({
        where: { id: input.id },
        include: { calendar: { select: { brandId: true } } },
      });
      if (!milestone) throw new TRPCError({ code: 'NOT_FOUND', message: 'Milestone non trovata' });
      await assertBrandAccess(ctx.session.user.id, milestone.calendar.brandId, ctx.prisma);

      const result = await updateMilestone(input.id, input.data, ctx.prisma);
      await logAudit(ctx, { action: 'CALENDAR_MILESTONE_UPDATE', targetType: 'CalendarMilestone', targetId: input.id, result: 'SUCCESS', metadata: {} });
      syncOneMilestone(input.id, ctx.prisma, ctx.logger).catch(err => ctx.logger.error(err, 'gcal sync failed on update'));
      return result;
    }),

  deleteMilestone: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const milestone = await ctx.prisma.calendarMilestone.findUnique({
        where: { id: input.id },
        include: { calendar: { select: { brandId: true } } },
      });
      if (!milestone) throw new TRPCError({ code: 'NOT_FOUND', message: 'Milestone non trovata' });
      await assertBrandAccess(ctx.session.user.id, milestone.calendar.brandId, ctx.prisma);

      await cleanupMilestoneEvents(input.id, ctx.prisma, ctx.logger);
      await deleteMilestone(input.id, ctx.prisma);
      await logAudit(ctx, { action: 'CALENDAR_MILESTONE_DELETE', targetType: 'CalendarMilestone', targetId: input.id, result: 'SUCCESS', metadata: {} });
      return { success: true };
    }),

  setMilestoneStatus: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum(CALENDAR_MILESTONE_STATUS),
    }))
    .mutation(async ({ input, ctx }) => {
      const milestone = await ctx.prisma.calendarMilestone.findUnique({
        where: { id: input.id },
        include: { calendar: { select: { brandId: true } } },
      });
      if (!milestone) throw new TRPCError({ code: 'NOT_FOUND', message: 'Milestone non trovata' });
      await assertBrandAccess(ctx.session.user.id, milestone.calendar.brandId, ctx.prisma);

      const result = await ctx.prisma.calendarMilestone.update({
        where: { id: input.id },
        data: { status: input.status },
      });
      await logAudit(ctx, { action: 'CALENDAR_MILESTONE_STATUS_UPDATE', targetType: 'CalendarMilestone', targetId: input.id, result: 'SUCCESS', metadata: { status: input.status } });
      syncOneMilestone(input.id, ctx.prisma, ctx.logger).catch(err => ctx.logger.error(err, 'gcal sync failed on status change'));
      return result;
    }),

  // ─── Personal notes ─────────────────────────────────────────────────────────

  upsertNote: protectedProcedure
    .use(requirePermission('season_calendar:read'))
    .use(withRateLimit('configMutations'))
    .input(MilestonePersonalNoteInputSchema)
    .mutation(async ({ input, ctx }) => {
      return upsertNote(input.milestoneId, ctx.session.user.id, input.body, ctx.prisma);
    }),

  deleteNote: protectedProcedure
    .use(requirePermission('season_calendar:read'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ milestoneId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await deleteNote(input.milestoneId, ctx.session.user.id, ctx.prisma);
      return { success: true };
    }),

  // ─── Templates ──────────────────────────────────────────────────────────────

  listTemplates: protectedProcedure
    .use(requirePermission('milestone_template:read'))
    .query(async ({ ctx }) => listTemplates(ctx.prisma)),

  applyTemplate: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({
      calendarId: z.string().uuid(),
      templateId: z.string().uuid(),
      anchorDate: z.string().datetime().optional(),
      force: z.boolean().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const calendar = await ctx.prisma.seasonCalendar.findUnique({
        where: { id: input.calendarId },
        select: { brandId: true, anchorDate: true },
      });
      if (!calendar) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
      await assertBrandAccess(ctx.session.user.id, calendar.brandId, ctx.prisma);

      const anchor = input.anchorDate
        ? new Date(input.anchorDate)
        : (calendar.anchorDate ?? null);
      if (!anchor) throw new TRPCError({ code: 'BAD_REQUEST', message: 'anchorDate richiesta' });

      const result = await applyTemplate(input.calendarId, input.templateId, anchor, input.force, ctx.prisma);
      await logAudit(ctx, { action: 'SEASON_CALENDAR_APPLY_TEMPLATE', targetType: 'SeasonCalendar', targetId: input.calendarId, result: 'SUCCESS', metadata: { templateId: input.templateId, count: result.length } });
      return result;
    }),

  // ─── Template CRUD ──────────────────────────────────────────────────────────

  createTemplate: protectedProcedure
    .use(requirePermission('milestone_template:create'))
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await createTemplate(input, ctx.prisma);
      await logAudit(ctx, { action: 'MILESTONE_TEMPLATE_CREATE', targetType: 'MilestoneTemplate', targetId: result.id, result: 'SUCCESS', metadata: { name: result.name } });
      return result;
    }),

  updateTemplate: protectedProcedure
    .use(requirePermission('milestone_template:update'))
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const result = await updateTemplate(id, data, ctx.prisma);
      await logAudit(ctx, { action: 'MILESTONE_TEMPLATE_UPDATE', targetType: 'MilestoneTemplate', targetId: id, result: 'SUCCESS' });
      return result;
    }),

  deleteTemplate: protectedProcedure
    .use(requirePermission('milestone_template:delete'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await deleteTemplate(input.id, ctx.prisma);
      await logAudit(ctx, { action: 'MILESTONE_TEMPLATE_DELETE', targetType: 'MilestoneTemplate', targetId: input.id, result: 'SUCCESS' });
      return { success: true };
    }),

  createTemplateItem: protectedProcedure
    .use(requirePermission('milestone_template:create'))
    .input(z.object({
      templateId: z.string().uuid(),
      title: z.string().min(1).max(200),
      type: z.enum(CALENDAR_MILESTONE_TYPE),
      ownerSectionKey: z.enum(PLANNING_SECTION_KEYS),
      visibleSectionKeys: z.array(z.enum(PLANNING_SECTION_KEYS)).min(1),
      offsetDays: z.number().int(),
      durationDays: z.number().int().min(0).default(0),
      publishExternally: z.boolean().default(true),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { templateId, ...data } = input;
      const result = await createTemplateItem(templateId, data, ctx.prisma);
      await logAudit(ctx, { action: 'MILESTONE_TEMPLATE_ITEM_CREATE', targetType: 'MilestoneTemplateItem', targetId: result.id, result: 'SUCCESS', metadata: { templateId } });
      return result;
    }),

  updateTemplateItem: protectedProcedure
    .use(requirePermission('milestone_template:update'))
    .input(z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(200).optional(),
      type: z.enum(CALENDAR_MILESTONE_TYPE).optional(),
      ownerSectionKey: z.enum(PLANNING_SECTION_KEYS).optional(),
      visibleSectionKeys: z.array(z.enum(PLANNING_SECTION_KEYS)).min(1).optional(),
      offsetDays: z.number().int().optional(),
      durationDays: z.number().int().min(0).optional(),
      publishExternally: z.boolean().optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const { id, ...data } = input;
      const result = await updateTemplateItem(id, data, ctx.prisma);
      await logAudit(ctx, { action: 'MILESTONE_TEMPLATE_ITEM_UPDATE', targetType: 'MilestoneTemplateItem', targetId: id, result: 'SUCCESS' });
      return result;
    }),

  deleteTemplateItem: protectedProcedure
    .use(requirePermission('milestone_template:delete'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await deleteTemplateItem(input.id, ctx.prisma);
      await logAudit(ctx, { action: 'MILESTONE_TEMPLATE_ITEM_DELETE', targetType: 'MilestoneTemplateItem', targetId: input.id, result: 'SUCCESS' });
      return { success: true };
    }),

  // ─── Clone ──────────────────────────────────────────────────────────────────

  cloneFromBrandSeason: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(CloneSeasonCalendarInputSchema)
    .mutation(async ({ input, ctx }) => {
      await assertBrandAccess(ctx.session.user.id, input.sourceBrandId, ctx.prisma);
      await assertBrandAccess(ctx.session.user.id, input.targetBrandId, ctx.prisma);

      const result = await cloneFromBrandSeason(input, ctx.prisma);
      await logAudit(ctx, { action: 'SEASON_CALENDAR_CLONE', targetType: 'SeasonCalendar', targetId: result.calendarId, result: 'SUCCESS', metadata: { sourceBrandId: input.sourceBrandId, sourceSeasonId: input.sourceSeasonId } });
      return result;
    }),

  // ─── Google sync ─────────────────────────────────────────────────────────────

  getSyncStatus: protectedProcedure
    .use(requirePermission('season_calendar:read'))
    .input(z.object({ calendarId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const calendar = await ctx.prisma.seasonCalendar.findUnique({
        where: { id: input.calendarId },
        select: { brandId: true },
      });
      if (!calendar) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
      await assertBrandAccess(ctx.session.user.id, calendar.brandId, ctx.prisma);
      return getSyncStatus(input.calendarId, ctx.prisma);
    }),

  triggerSync: protectedProcedure
    .use(requirePermission('season_calendar:sync'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ calendarId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const calendar = await ctx.prisma.seasonCalendar.findUnique({
        where: { id: input.calendarId },
        select: { brandId: true },
      });
      if (!calendar) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
      await assertBrandAccess(ctx.session.user.id, calendar.brandId, ctx.prisma);
      const syncResult = await reconcileCalendar(input.calendarId, ctx.prisma, ctx.logger);
      await logAudit(ctx, { action: 'SEASON_CALENDAR_SYNC_TRIGGERED', targetType: 'SeasonCalendar', targetId: input.calendarId, result: 'SUCCESS', metadata: syncResult });
      return { triggered: true, ...syncResult };
    }),
});
