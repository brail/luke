import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';
import { detectViolations, suggestResolution, type GraphInput } from '@luke/calendar';

import {
  CalendarEventInputSchema,
  CalendarEventBaseSchema,
  CloneSeasonCalendarInputSchema,
  CalendarEventPersonalNoteInputSchema,
  CalendarEventUserVisibilityInputSchema,
  CalendarEventDependencyInputSchema,
  UpdateDependencyGapsInputSchema,
  CalendarEventAnchorInputSchema,
  WhatIfRequestSchema,
  SEASON_CALENDAR_STATUS,
  CALENDAR_EVENT_STATUS,
  hasPermission,
  type Role,
} from '@luke/core';

import { assertFunctionMemberOrAdmin } from './company.js';

import { logAudit } from '../lib/auditLog.js';
import { createNotification, getVisibleUserIdsForMilestone } from '../lib/notifications.js';
import { withRateLimit } from '../lib/ratelimit.js';
import { router, protectedProcedure } from '../lib/trpc.js';
import { requirePermission } from '../lib/permissions.js';
import {
  syncOneMilestone,
  cleanupMilestoneEvents,
  reconcileCalendar,
} from '../services/googleCalendarSync.service.js';

import { executeEffect } from '../services/calendar/effects/executor.js';
import { rollbackEffect } from '../services/calendar/effects/rollback.js';
import { loadHolidaysForSolver } from '../services/calendar/holidayQuery.js';

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
      const result = await ctx.prisma.$transaction(async tx => {
        const txClient = tx as unknown as PrismaClient;
        const calendar = await txClient.seasonCalendar.findUnique({
          where: { id: input.calendarId },
          select: { brandId: true },
        });
        if (!calendar) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
        await assertBrandAccess(ctx.session.user.id, calendar.brandId, txClient);
        return updateCalendarStatus(input.calendarId, input.status, txClient);
      });
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

  // ─── Calendar event queries ─────────────────────────────────────────────────

  listMilestones: protectedProcedure
    .use(requirePermission('season_calendar:read'))
    .input(z.object({
      seasonId: z.string().uuid(),
      brandIds: z.array(z.string().uuid()).min(1),
      functionId: z.string().uuid().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const allowedBrandIds = hasPermission({ role: ctx.session.user.role as Role }, '*:*')
        ? input.brandIds
        : await filterAllowedBrandIds(ctx.session.user.id, input.brandIds, ctx.prisma);
      if (allowedBrandIds.length === 0) return [];
      return listMilestonesDb(input.seasonId, allowedBrandIds, ctx.session.user.id, ctx.prisma, input.functionId);
    }),

  // ─── Calendar event mutations ───────────────────────────────────────────────

  createMilestone: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(CalendarEventInputSchema)
    .mutation(async ({ input, ctx }) => {
      const calendar = await ctx.prisma.seasonCalendar.findUnique({
        where: { id: input.calendarId },
        select: { brandId: true },
      });
      if (!calendar) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
      await assertBrandAccess(ctx.session.user.id, calendar.brandId, ctx.prisma);

      const result = await createMilestone(input, ctx.prisma);
      await logAudit(ctx, { action: 'CALENDAR_EVENT_CREATE', targetType: 'CalendarEvent', targetId: result.id, result: 'SUCCESS', metadata: { calendarId: input.calendarId, ownerFunctionId: input.ownerFunctionId } });
      syncOneMilestone(result.id, ctx.prisma, ctx.logger).catch(err => ctx.logger.error(err, 'gcal sync failed on create'));
      return result;
    }),

  updateMilestone: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({
      id: z.string().uuid(),
      data: CalendarEventBaseSchema.partial().omit({ calendarId: true }),
    }))
    .mutation(async ({ input, ctx }) => {
      const event = await ctx.prisma.calendarEvent.findUnique({
        where: { id: input.id },
        include: { calendar: { select: { brandId: true } } },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });
      await assertBrandAccess(ctx.session.user.id, event.calendar.brandId, ctx.prisma);

      const result = await updateMilestone(input.id, input.data, ctx.prisma);
      await logAudit(ctx, { action: 'CALENDAR_EVENT_UPDATE', targetType: 'CalendarEvent', targetId: input.id, result: 'SUCCESS', metadata: {} });
      syncOneMilestone(input.id, ctx.prisma, ctx.logger).catch(err => ctx.logger.error(err, 'gcal sync failed on update'));
      return result;
    }),

  deleteMilestone: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const event = await ctx.prisma.calendarEvent.findUnique({
        where: { id: input.id },
        include: { calendar: { select: { brandId: true } } },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });
      await assertBrandAccess(ctx.session.user.id, event.calendar.brandId, ctx.prisma);

      await cleanupMilestoneEvents(input.id, ctx.prisma, ctx.logger);
      await deleteMilestone(input.id, ctx.prisma);
      await logAudit(ctx, { action: 'CALENDAR_MILESTONE_DELETE', targetType: 'CalendarMilestone', targetId: input.id, result: 'SUCCESS', metadata: {} });
      return { success: true };
    }),

  deleteMilestones: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      const events = await ctx.prisma.calendarEvent.findMany({
        where: { id: { in: input.ids } },
        include: { calendar: { select: { brandId: true } } },
      });
      const uniqueBrandIds = [...new Set(events.map(e => e.calendar.brandId).filter((id): id is string => id != null))];
      await Promise.all(uniqueBrandIds.map(brandId =>
        assertBrandAccess(ctx.session.user.id, brandId, ctx.prisma)
      ));
      await Promise.all(events.map(e => cleanupMilestoneEvents(e.id, ctx.prisma, ctx.logger)));
      await ctx.prisma.calendarEvent.deleteMany({ where: { id: { in: input.ids } } });
      await logAudit(ctx, { action: 'CALENDAR_EVENT_DELETE', targetType: 'CalendarEvent', targetId: input.ids.join(','), result: 'SUCCESS', metadata: { count: input.ids.length } });
      return { success: true, count: input.ids.length };
    }),

  setMilestoneStatus: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum(CALENDAR_EVENT_STATUS),
    }))
    .mutation(async ({ input, ctx }) => {
      const event = await ctx.prisma.calendarEvent.findUnique({
        where: { id: input.id },
        include: {
          calendar: { select: { brandId: true } },
          stateEffects: true,
        },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });
      await assertBrandAccess(ctx.session.user.id, event.calendar.brandId, ctx.prisma);

      const result = await ctx.prisma.calendarEvent.update({
        where: { id: input.id },
        data: { status: input.status },
      });

      // Auto-execute effects when transitioning to COMPLETED
      const autoApplied: string[] = [];
      const pending: string[] = [];
      const autoRolledBack: string[] = [];
      const pendingRollback: string[] = [];

      if (input.status === 'COMPLETED') {
        const auto = event.stateEffects.filter(e => !e.requiresConfirmation);
        pending.push(...event.stateEffects.filter(e => e.requiresConfirmation).map(e => e.id));
        await Promise.all(auto.map(async effect => {
          try {
            await executeEffect(ctx.prisma, effect.id, ctx.session.user.id);
            autoApplied.push(effect.id);
          } catch (err) {
            ctx.logger.error(err, `auto-effect failed: ${effect.id}`);
          }
        }));
      } else if ((event.status as string) === 'COMPLETED') {
        const executions = await ctx.prisma.calendarEventEffectExecution.findMany({
          where: { eventId: input.id, rolledBackAt: null },
          include: { effect: { select: { requiresConfirmation: true } } },
        });
        const autoExecs = executions.filter(e => !e.effect.requiresConfirmation);
        pendingRollback.push(...executions.filter(e => e.effect.requiresConfirmation).map(e => e.id));
        await Promise.all(autoExecs.map(async exec => {
          try {
            await rollbackEffect(ctx.prisma, exec.id, ctx.session.user.id);
            autoRolledBack.push(exec.id);
          } catch (err) {
            ctx.logger.error(err, `auto-rollback failed: ${exec.id}`);
          }
        }));
      }

      await logAudit(ctx, { action: 'CALENDAR_EVENT_STATUS_UPDATE', targetType: 'CalendarEvent', targetId: input.id, result: 'SUCCESS', metadata: { status: input.status } });
      syncOneMilestone(input.id, ctx.prisma, ctx.logger).catch(err => ctx.logger.error(err, 'gcal sync failed on status change'));

      const STATUS_LABELS: Record<string, string> = {
        PLANNED: 'In pianificazione', IN_PROGRESS: 'In corso',
        COMPLETED: 'Completata', CANCELLED: 'Annullata',
      };
      const statusLabel = STATUS_LABELS[input.status] ?? input.status;
      void getVisibleUserIdsForMilestone(input.id, ctx.prisma)
        .then(async userIds => {
          const batchSize = 10;
          for (let i = 0; i < userIds.length; i += batchSize) {
            await Promise.allSettled(
              userIds.slice(i, i + batchSize).map(userId =>
                createNotification(ctx.prisma, {
                  userId,
                  category: 'CALENDAR',
                  title: 'Evento aggiornato',
                  message: `"${event.title}" → ${statusLabel}`,
                  link: '/calendar',
                  data: { eventId: input.id, status: input.status },
                }).catch(e => ctx.logger.error({ err: e, userId }, 'notification failed on event status change'))
              )
            );
          }
        })
        .catch(err => ctx.logger.error(err, 'notification fanout failed on event status change'));

      return { event: result, autoApplied, pending, autoRolledBack, pendingRollback };
    }),

  // ─── Personal notes ─────────────────────────────────────────────────────────

  upsertNote: protectedProcedure
    .use(requirePermission('season_calendar:read'))
    .use(withRateLimit('configMutations'))
    .input(CalendarEventPersonalNoteInputSchema)
    .mutation(async ({ input, ctx }) => {
      if (input.body.trim() === '') {
        await deleteNote(input.eventId, ctx.session.user.id, ctx.prisma);
        return null;
      }
      return upsertNote(input.eventId, ctx.session.user.id, input.body, ctx.prisma);
    }),

  deleteNote: protectedProcedure
    .use(requirePermission('season_calendar:read'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ eventId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await deleteNote(input.eventId, ctx.session.user.id, ctx.prisma);
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
      type: z.string().min(1),
      ownerFunctionId: z.string().uuid(),
      visibilityFunctionIds: z.array(z.string().uuid()).min(1),
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
      type: z.string().min(1).optional(),
      ownerFunctionId: z.string().uuid().optional(),
      visibilityFunctionIds: z.array(z.string().uuid()).min(1).optional(),
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

  grantUserVisibility: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(CalendarEventUserVisibilityInputSchema)
    .mutation(async ({ input, ctx }) => {
      const event = await ctx.prisma.calendarEvent.findUnique({
        where: { id: input.eventId },
        select: { ownerFunctionId: true, title: true },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });

      await assertFunctionMemberOrAdmin(ctx, event.ownerFunctionId);

      await ctx.prisma.calendarEventUserVisibility.createMany({
        data: input.userIds.map(userId => ({
          eventId: input.eventId,
          userId,
          grantedBy: ctx.session.user.id,
        })),
        skipDuplicates: true,
      });

      await Promise.all(
        input.userIds.map(userId =>
          logAudit(ctx, {
            action: 'CALENDAR_EVENT_USER_VISIBILITY_GRANTED',
            targetType: 'CalendarEventUserVisibility',
            targetId: `${input.eventId}:${userId}`,
            result: 'SUCCESS',
            metadata: { eventId: input.eventId, userId },
          })
        )
      );

      await Promise.all(
        input.userIds.map(userId =>
          createNotification(ctx.prisma, {
            userId,
            category: 'USER_ACTION',
            title: 'Accesso evento concesso',
            message: `Hai accesso all'evento "${event.title}"`,
            link: '/calendar',
            data: { eventId: input.eventId },
          })
        )
      );

      return { ok: true };
    }),

  // ─── Dependencies ───────────────────────────────────────────────────────────

  getDependencies: protectedProcedure
    .use(requirePermission('season_calendar:read'))
    .input(z.object({ calendarId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const calendar = await ctx.prisma.seasonCalendar.findUnique({
        where: { id: input.calendarId },
        select: { brandId: true },
      });
      if (!calendar) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
      await assertBrandAccess(ctx.session.user.id, calendar.brandId, ctx.prisma);

      const events = await ctx.prisma.calendarEvent.findMany({
        where: { calendarId: input.calendarId },
        select: { id: true },
      });
      const eventIds = events.map(e => e.id);

      return ctx.prisma.calendarEventDependency.findMany({
        where: { OR: [{ predecessorId: { in: eventIds } }, { successorId: { in: eventIds } }] },
        orderBy: { createdAt: 'asc' },
      });
    }),

  addDependency: protectedProcedure
    .use(requirePermission('season_calendar:configure_dependencies'))
    .use(withRateLimit('configMutations'))
    .input(CalendarEventDependencyInputSchema)
    .mutation(async ({ input, ctx }) => {
      const [pred, succ] = await Promise.all([
        ctx.prisma.calendarEvent.findUnique({
          where: { id: input.predecessorId },
          select: { calendarId: true },
        }),
        ctx.prisma.calendarEvent.findUnique({
          where: { id: input.successorId },
          select: { calendarId: true },
        }),
      ]);
      if (!pred || !succ) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });

      const result = await ctx.prisma.calendarEventDependency.create({
        data: {
          predecessorId: input.predecessorId,
          successorId: input.successorId,
          minGapDays: input.minGapDays,
          maxGapDays: input.maxGapDays,
          severity: input.severity,
          reason: input.reason,
          isDisabled: false,
          inheritedFromId: null,
        },
      });
      await logAudit(ctx, { action: 'CALENDAR_DEPENDENCY_ADD', targetType: 'CalendarEventDependency', targetId: result.id, result: 'SUCCESS', metadata: { predecessorId: input.predecessorId, successorId: input.successorId } });
      return result;
    }),

  updateDependencyGaps: protectedProcedure
    .use(requirePermission('season_calendar:configure_dependencies'))
    .use(withRateLimit('configMutations'))
    .input(UpdateDependencyGapsInputSchema)
    .mutation(async ({ input, ctx }) => {
      const dep = await ctx.prisma.calendarEventDependency.findUnique({ where: { id: input.id } });
      if (!dep) throw new TRPCError({ code: 'NOT_FOUND', message: 'Dipendenza non trovata' });

      const result = await ctx.prisma.calendarEventDependency.update({
        where: { id: input.id },
        data: {
          ...(input.minGapDays !== undefined ? { minGapDays: input.minGapDays } : {}),
          ...(input.maxGapDays !== undefined ? { maxGapDays: input.maxGapDays } : {}),
        },
      });
      await logAudit(ctx, { action: 'CALENDAR_DEPENDENCY_UPDATE_GAPS', targetType: 'CalendarEventDependency', targetId: input.id, result: 'SUCCESS', metadata: { minGapDays: input.minGapDays, maxGapDays: input.maxGapDays } });
      return result;
    }),

  toggleDependencyDisabled: protectedProcedure
    .use(requirePermission('season_calendar:configure_dependencies'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid(), isDisabled: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      const dep = await ctx.prisma.calendarEventDependency.findUnique({ where: { id: input.id } });
      if (!dep) throw new TRPCError({ code: 'NOT_FOUND', message: 'Dipendenza non trovata' });
      if (!dep.inheritedFromId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Solo le dipendenze ereditate possono essere disabilitate. Le dipendenze custom si eliminano.' });
      }
      const result = await ctx.prisma.calendarEventDependency.update({
        where: { id: input.id },
        data: { isDisabled: input.isDisabled },
      });
      await logAudit(ctx, { action: 'CALENDAR_DEPENDENCY_TOGGLE', targetType: 'CalendarEventDependency', targetId: input.id, result: 'SUCCESS', metadata: { isDisabled: input.isDisabled } });
      return result;
    }),

  deleteDependency: protectedProcedure
    .use(requirePermission('season_calendar:configure_dependencies'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const dep = await ctx.prisma.calendarEventDependency.findUnique({ where: { id: input.id } });
      if (!dep) throw new TRPCError({ code: 'NOT_FOUND', message: 'Dipendenza non trovata' });
      if (dep.inheritedFromId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Le dipendenze ereditate non possono essere eliminate — usa disabilita.' });
      }
      await ctx.prisma.calendarEventDependency.delete({ where: { id: input.id } });
      await logAudit(ctx, { action: 'CALENDAR_DEPENDENCY_DELETE', targetType: 'CalendarEventDependency', targetId: input.id, result: 'SUCCESS', metadata: {} });
      return { success: true };
    }),

  // ─── Anchors ────────────────────────────────────────────────────────────────

  setEventAnchors: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({
      eventId: z.string().uuid(),
      anchors: z.array(CalendarEventAnchorInputSchema),
    }))
    .mutation(async ({ input, ctx }) => {
      const event = await ctx.prisma.calendarEvent.findUnique({
        where: { id: input.eventId },
        include: { calendar: { select: { brandId: true } } },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });
      await assertBrandAccess(ctx.session.user.id, event.calendar.brandId, ctx.prisma);

      await ctx.prisma.$transaction(async tx => {
        await tx.calendarEventAnchor.deleteMany({ where: { eventId: input.eventId } });
        if (input.anchors.length > 0) {
          await tx.calendarEventAnchor.createMany({
            data: input.anchors.map(a => ({
              eventId: input.eventId,
              entityType: a.entityType,
              entityId: a.entityId,
            })),
          });
        }
      });
      await logAudit(ctx, { action: 'CALENDAR_EVENT_ANCHORS_SET', targetType: 'CalendarEventAnchor', targetId: input.eventId, result: 'SUCCESS', metadata: { count: input.anchors.length } });
      return { success: true };
    }),

  // ─── State effects (manual) ─────────────────────────────────────────────────

  executeStateEffect: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ effectId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const execution = await executeEffect(ctx.prisma, input.effectId, ctx.session.user.id);
      await logAudit(ctx, { action: 'CALENDAR_STATE_EFFECT_EXECUTE', targetType: 'CalendarEventEffectExecution', targetId: execution.id, result: 'SUCCESS', metadata: { effectId: input.effectId } });
      return execution;
    }),

  rollbackStateEffect: protectedProcedure
    .use(requirePermission('collection_layout:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ executionId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await rollbackEffect(ctx.prisma, input.executionId, ctx.session.user.id);
      await logAudit(ctx, { action: 'CALENDAR_STATE_EFFECT_ROLLBACK', targetType: 'CalendarEventEffectExecution', targetId: input.executionId, result: 'SUCCESS', metadata: {} });
      return { success: true };
    }),

  // ─── Simulate (what-if engine) ───────────────────────────────────────────────

  simulate: protectedProcedure
    .use(requirePermission('season_calendar:simulate'))
    .input(WhatIfRequestSchema)
    .mutation(async ({ input, ctx }) => {
      // Load all events in the requested calendars
      const events = await ctx.prisma.calendarEvent.findMany({
        where: { calendarId: { in: input.calendarIds } },
        select: {
          id: true,
          startAt: true,
          endAt: true,
          severity: true,
          relevantCountries: true,
          dependenciesAsPredecessor: {
            select: {
              id: true, predecessorId: true, successorId: true,
              minGapDays: true, maxGapDays: true, severity: true,
              reason: true, isDisabled: true,
            },
          },
        },
      });

      // Collect all deps (each dep stored once on predecessor side)
      const dependencies = events.flatMap(e => e.dependenciesAsPredecessor);

      // Collect unique country codes to load holidays
      const countryCodes = [...new Set(events.flatMap(e => e.relevantCountries))];
      const holidays = await loadHolidaysForSolver(ctx.prisma, countryCodes);

      const graphInput: GraphInput = {
        events: events.map(e => ({
          id: e.id,
          startAt: e.startAt,
          endAt: e.endAt,
          severity: e.severity,
          relevantCountries: e.relevantCountries,
        })),
        dependencies: dependencies.map(d => ({
          id: d.id,
          predecessorId: d.predecessorId,
          successorId: d.successorId,
          minGapDays: d.minGapDays ?? undefined,
          maxGapDays: d.maxGapDays ?? undefined,
          severity: d.severity,
          reason: d.reason ?? undefined,
          isDisabled: d.isDisabled,
        })),
        holidays,
      };

      const eventById = new Map(events.map(e => [e.id, e]));
      const proposedShifts = input.proposedShifts.map(s => ({
        eventId: s.eventId,
        fromStartAt: eventById.get(s.eventId)?.startAt ?? new Date(s.newStartAt),
        toStartAt: new Date(s.newStartAt),
        reason: 'Proposta utente',
      }));

      const violations = detectViolations(graphInput, proposedShifts);
      const suggestion = input.requestSuggestion
        ? suggestResolution(graphInput, proposedShifts)
        : null;

      return { violations, suggestion };
    }),

  revokeUserVisibility: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('companyStructureMutations'))
    .input(z.object({ eventId: z.string().uuid(), userIds: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ input, ctx }) => {
      const event = await ctx.prisma.calendarEvent.findUnique({
        where: { id: input.eventId },
        select: { ownerFunctionId: true, title: true },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });

      await assertFunctionMemberOrAdmin(ctx, event.ownerFunctionId);

      await ctx.prisma.calendarEventUserVisibility.deleteMany({
        where: { eventId: input.eventId, userId: { in: input.userIds } },
      });

      await Promise.all(
        input.userIds.map(userId =>
          logAudit(ctx, {
            action: 'CALENDAR_EVENT_USER_VISIBILITY_REVOKED',
            targetType: 'CalendarEventUserVisibility',
            targetId: `${input.eventId}:${userId}`,
            result: 'SUCCESS',
            metadata: { eventId: input.eventId, userId },
          })
        )
      );

      await Promise.all(
        input.userIds.map(userId =>
          createNotification(ctx.prisma, {
            userId,
            category: 'USER_ACTION',
            title: 'Accesso evento revocato',
            message: `Hai perso accesso all'evento "${event.title}"`,
            data: { eventId: input.eventId },
          })
        )
      );

      return { ok: true };
    }),
});
