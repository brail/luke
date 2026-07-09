/**
 * tRPC router for season calendar management.
 *
 * Covers the full lifecycle of a seasonal planning calendar:
 *  - Calendar CRUD: getOrCreate, updateStatus, setAnchorDate, freezeCalendar
 *  - Milestones: listMilestones, createMilestone, updateMilestone, deleteMilestone(s), setMilestoneStatus
 *  - Personal notes: upsertNote, deleteNote
 *  - Templates: listTemplates, applyTemplate, createTemplate, updateTemplate, deleteTemplate,
 *               createTemplateItem, updateTemplateItem, deleteTemplateItem
 *  - Clone: cloneFromBrandSeason
 *  - Google Calendar sync: getSyncStatus, triggerSync
 *  - User visibility: grantUserVisibility, revokeUserVisibility
 *  - Anchors: setEventAnchors
 *  - State effects: executeStateEffect, rollbackStateEffect
 *
 * Brand access is enforced per-operation via `assertBrandAccess`.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';


import {
  CalendarEventInputSchema,
  CalendarEventBaseSchema,
  CloneSeasonCalendarInputSchema,
  CalendarEventPersonalNoteInputSchema,
  CalendarEventUserVisibilityInputSchema,
  CalendarEventAnchorInputSchema,
  MilestoneTemplateItemBaseSchema,
  MilestoneTemplateItemInputSchema,
  SEASON_CALENDAR_STATUS,
  CALENDAR_EVENT_STATUS,
  hasPermission,
  type Role,
} from '@luke/core';


import { logAudit } from '../lib/auditLog.js';
import { toErrorMessage } from '../lib/error.js';
import { createNotification, getVisibleUserIdsForMilestone, getVisibleUserIdsForMilestones, notifyCalendarChange } from '../lib/notifications.js';
import { requirePermission } from '../lib/permissions.js';
import { withRateLimit } from '../lib/ratelimit.js';
import { sseStore } from '../lib/sseStore.js';
import { router, protectedProcedure } from '../lib/trpc.js';
import { executeEffect } from '../services/calendar/effects/executor.js';
import { rollbackEffect } from '../services/calendar/effects/rollback.js';
import { assertUnlocked } from '../services/editLock.service.js';
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
  freezeCalendar,
  unfreezeCalendar,
  listMilestonesDb,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  duplicateEventsFrom,
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

import { assertFunctionMemberOrAdmin } from './company.js';

import type { PrismaClient } from '@prisma/client';

export const seasonCalendarRouter = router({
  // ─── Calendar management ────────────────────────────────────────────────────

  /**
   * Returns the season calendar for a brand/season pair, creating one if it does not exist.
   *
   * @auth season_calendar:read
   * @input { brandId, seasonId }
   * @output SeasonCalendar record
   */
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

  /**
   * Updates the status of a season calendar (e.g. DRAFT → ACTIVE → ARCHIVED).
   *
   * @auth season_calendar:update
   * @input { calendarId, status }
   * @output Updated SeasonCalendar
   */
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

  /**
   * Sets the anchor date used to apply milestone templates with date offsets.
   *
   * @auth season_calendar:update
   * @input { calendarId, anchorDate }
   * @output Updated SeasonCalendar
   */
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

  /**
   * Freezes a calendar's baseline: snapshots every event's current startAt/endAt into
   * baselineStartAt/baselineEndAt, written once. startAt/endAt remain freely editable afterwards.
   *
   * @auth season_calendar:freeze
   * @input { calendarId }
   * @output Updated SeasonCalendar
   */
  freezeCalendar: protectedProcedure
    .use(requirePermission('season_calendar:freeze'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ calendarId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const calendar = await ctx.prisma.seasonCalendar.findUnique({
        where: { id: input.calendarId },
        select: { brandId: true },
      });
      if (!calendar) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
      await assertBrandAccess(ctx.session.user.id, calendar.brandId, ctx.prisma);
      await assertUnlocked('SEASON_CALENDAR', input.calendarId, ctx.session.user.id, ctx.prisma);
      const result = await freezeCalendar(input.calendarId, ctx.prisma);
      await logAudit(ctx, { action: 'CALENDAR_FROZEN', targetType: 'SeasonCalendar', targetId: input.calendarId, result: 'SUCCESS', metadata: {} });
      return result;
    }),

  /**
   * Admin-only: reverts a freeze, clearing the calendar's `frozenAt` and every event's baseline
   * snapshot. Used to correct an accidental or premature freeze.
   *
   * @auth season_calendar:unfreeze (admin wildcard only — not granted to editor/viewer)
   * @input { calendarId }
   * @output Updated SeasonCalendar
   */
  unfreezeCalendar: protectedProcedure
    .use(requirePermission('season_calendar:unfreeze'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ calendarId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const calendar = await ctx.prisma.seasonCalendar.findUnique({
        where: { id: input.calendarId },
        select: { brandId: true },
      });
      if (!calendar) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
      await assertBrandAccess(ctx.session.user.id, calendar.brandId, ctx.prisma);
      const result = await unfreezeCalendar(input.calendarId, ctx.prisma);
      await logAudit(ctx, { action: 'CALENDAR_UNFROZEN', targetType: 'SeasonCalendar', targetId: input.calendarId, result: 'SUCCESS', metadata: {} });
      return result;
    }),

  // ─── Calendar event queries ─────────────────────────────────────────────────

  /**
   * Lists milestones for the given season and brands, filtered to brands the user can access.
   *
   * Admins see all requested brands; other roles are filtered by team-brand scopes.
   *
   * @auth season_calendar:read
   * @input { seasonId, brandIds, functionId? }
   * @output Array of CalendarEvent records
   */
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

  /**
   * Creates a calendar event (milestone) and triggers an async Google Calendar sync.
   *
   * @auth season_calendar:update
   * @input CalendarEventInputSchema
   * @output The created CalendarEvent
   */
  createMilestone: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(CalendarEventInputSchema)
    .mutation(async ({ input, ctx }) => {
      const calendar = await ctx.prisma.seasonCalendar.findUnique({
        where: { id: input.calendarId },
        select: { brandId: true, seasonId: true },
      });
      if (!calendar) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
      await assertBrandAccess(ctx.session.user.id, calendar.brandId, ctx.prisma);
      await assertUnlocked('SEASON_CALENDAR', input.calendarId, ctx.session.user.id, ctx.prisma);

      const result = await createMilestone(input, ctx.prisma);
      await logAudit(ctx, { action: 'CALENDAR_EVENT_CREATE', targetType: 'CalendarEvent', targetId: result.id, result: 'SUCCESS', metadata: { calendarId: input.calendarId, ownerFunctionId: input.ownerFunctionId, title: result.title } });
      sseStore.pushToAll({ type: 'calendar-updated', seasonId: calendar.seasonId });
      notifyCalendarChange(ctx.prisma, {
        eventId: result.id,
        actorId: ctx.session.user.id,
        titleSuffix: 'ha aggiunto un evento',
        message: `"${result.title}"`,
        calendarId: input.calendarId,
      }).catch(err => ctx.logger.error(err, 'calendar notification failed on create'));
      syncOneMilestone(result.id, ctx.prisma, ctx.logger).catch(err => ctx.logger.error(err, 'gcal sync failed on create'));
      return result;
    }),

  /**
   * Updates a calendar event and triggers an async Google Calendar sync.
   *
   * @auth season_calendar:update
   * @input { id, data: Partial<CalendarEventBase> }
   * @output Updated CalendarEvent
   */
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
        include: { calendar: { select: { brandId: true, seasonId: true } } },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });
      await assertBrandAccess(ctx.session.user.id, event.calendar.brandId, ctx.prisma);
      await assertUnlocked('SEASON_CALENDAR', event.calendarId, ctx.session.user.id, ctx.prisma);

      const result = await updateMilestone(input.id, input.data, ctx.prisma);

      const dateChanged = event.startAt.getTime() !== result.startAt.getTime()
        || (event.endAt?.getTime() ?? null) !== (result.endAt?.getTime() ?? null);
      const FIELD_LABELS: Record<string, string> = {
        description: 'Descrizione', type: 'Tipo evento',
        ownerFunctionId: 'Owner',
        publishExternally: 'Sincronizzazione Google', templateItemId: 'Template',
        allDay: 'Giornata intera',
      };
      const changedFields = Object.keys(FIELD_LABELS).filter(
        k => JSON.stringify((event as Record<string, unknown>)[k]) !== JSON.stringify((result as Record<string, unknown>)[k])
      ).map(k => FIELD_LABELS[k]);

      await logAudit(ctx, {
        action: 'CALENDAR_EVENT_UPDATE', targetType: 'CalendarEvent', targetId: input.id, result: 'SUCCESS',
        metadata: {
          title: result.title, calendarId: event.calendarId,
          ...(dateChanged && {
            oldStartAt: event.startAt.toISOString(), newStartAt: result.startAt.toISOString(),
            oldEndAt: event.endAt?.toISOString() ?? null, newEndAt: result.endAt?.toISOString() ?? null,
            allDay: result.allDay,
          }),
          ...(changedFields.length > 0 && { changedFields }),
        },
      });
      sseStore.pushToAll({ type: 'calendar-updated', seasonId: event.calendar.seasonId });
      notifyCalendarChange(ctx.prisma, {
        eventId: input.id,
        actorId: ctx.session.user.id,
        titleSuffix: 'ha modificato un evento',
        message: `"${result.title}"`,
        calendarId: event.calendarId,
      }).catch(err => ctx.logger.error(err, 'calendar notification failed on update'));
      syncOneMilestone(input.id, ctx.prisma, ctx.logger).catch(err => ctx.logger.error(err, 'gcal sync failed on update'));
      return result;
    }),

  /**
   * Deletes a calendar event and cleans up any associated Google Calendar events.
   *
   * @auth season_calendar:update
   * @input { id }
   * @output { success: true }
   */
  deleteMilestone: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const event = await ctx.prisma.calendarEvent.findUnique({
        where: { id: input.id },
        include: { calendar: { select: { brandId: true, seasonId: true } } },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });
      await assertBrandAccess(ctx.session.user.id, event.calendar.brandId, ctx.prisma);
      await assertUnlocked('SEASON_CALENDAR', event.calendarId, ctx.session.user.id, ctx.prisma);

      // Snapshot visibility before delete so digest and notification can use it afterward
      const visibleUserIds = await getVisibleUserIdsForMilestone(input.id, ctx.prisma);
      await cleanupMilestoneEvents(input.id, ctx.prisma, ctx.logger);
      await deleteMilestone(input.id, ctx.prisma);
      await logAudit(ctx, {
        action: 'CALENDAR_MILESTONE_DELETE', targetType: 'CalendarMilestone', targetId: input.id, result: 'SUCCESS',
        metadata: {
          title: event.title, calendarId: event.calendarId, visibleUserIds,
          startAt: event.startAt.toISOString(), endAt: event.endAt?.toISOString() ?? null, allDay: event.allDay,
        },
      });
      sseStore.pushToAll({ type: 'calendar-updated', seasonId: event.calendar.seasonId });
      notifyCalendarChange(ctx.prisma, {
        preloadedUserIds: visibleUserIds,
        actorId: ctx.session.user.id,
        titleSuffix: 'ha rimosso un evento',
        message: `"${event.title}"`,
        calendarId: event.calendarId,
      }).catch(err => ctx.logger.error(err, 'calendar notification failed on delete'));
      return { success: true };
    }),

  /**
   * Bulk-deletes up to 100 calendar events, cleaning up Google Calendar events for each.
   *
   * @auth season_calendar:update
   * @input { ids: string[] (1–100) }
   * @output { success: true, count: number }
   */
  deleteMilestones: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }))
    .mutation(async ({ input, ctx }) => {
      const events = await ctx.prisma.calendarEvent.findMany({
        where: { id: { in: input.ids } },
        include: { calendar: { select: { brandId: true, seasonId: true } } },
      });
      const uniqueBrandIds = [...new Set(events.map(e => e.calendar.brandId).filter((id): id is string => id != null))];
      await Promise.all(uniqueBrandIds.map(brandId =>
        assertBrandAccess(ctx.session.user.id, brandId, ctx.prisma)
      ));
      const calendarIdsToLockCheck = [...new Set(events.map(e => e.calendarId))];
      await Promise.all(calendarIdsToLockCheck.map(id =>
        assertUnlocked('SEASON_CALENDAR', id, ctx.session.user.id, ctx.prisma)
      ));
      // Snapshot visibility for each event before deletion (for digest + notifications)
      const visibilityMap = await getVisibleUserIdsForMilestones(events.map(e => e.id), ctx.prisma);
      const visibilitySnapshots = events.map(e => ({
        id: e.id,
        title: e.title,
        calendarId: e.calendarId,
        userIds: visibilityMap.get(e.id) ?? [],
        startAt: e.startAt.toISOString(),
        endAt: e.endAt?.toISOString() ?? null,
        allDay: e.allDay,
      }));
      await Promise.all(events.map(e => cleanupMilestoneEvents(e.id, ctx.prisma, ctx.logger)));
      await ctx.prisma.calendarEvent.deleteMany({ where: { id: { in: input.ids } } });
      await logAudit(ctx, {
        action: 'CALENDAR_EVENT_DELETE',
        targetType: 'CalendarEvent',
        targetId: input.ids.join(','),
        result: 'SUCCESS',
        metadata: {
          count: input.ids.length,
          snapshots: visibilitySnapshots.map(s => ({
            id: s.id, title: s.title, calendarId: s.calendarId, visibleUserIds: s.userIds,
            startAt: s.startAt, endAt: s.endAt, allDay: s.allDay,
          })),
        },
      });
      const uniqueSeasonIds = [...new Set(events.map(e => e.calendar.seasonId).filter((id): id is string => id != null))];
      for (const seasonId of uniqueSeasonIds) sseStore.pushToAll({ type: 'calendar-updated', seasonId });
      const allVisibleUserIds = [...new Set(visibilitySnapshots.flatMap(s => s.userIds))];
      const uniqueCalendarIds = [...new Set(events.map(e => e.calendarId))];
      notifyCalendarChange(ctx.prisma, {
        preloadedUserIds: allVisibleUserIds,
        actorId: ctx.session.user.id,
        titleSuffix: `ha rimosso ${input.ids.length} eventi`,
        message: `dal calendario`,
        calendarId: uniqueCalendarIds.length === 1 ? uniqueCalendarIds[0] : undefined,
      }).catch(err => ctx.logger.error(err, 'calendar notification failed on bulk delete'));
      return { success: true, count: input.ids.length };
    }),

  /**
   * Transitions a milestone to a new status, auto-applying or rolling back state effects.
   *
   * When transitioning to COMPLETED: non-confirmation-required effects are executed automatically;
   * confirmation-required effects are returned as `pending`.
   * When transitioning away from COMPLETED: previously auto-applied effects are rolled back.
   * Triggers a Google Calendar sync and sends notifications to all visible users.
   *
   * @auth season_calendar:update
   * @input { id, status }
   * @output { event, autoApplied, pending, autoRolledBack, pendingRollback }
   */
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
          calendar: { select: { brandId: true, seasonId: true } },
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
      const autoFailed: { id: string; error: string }[] = [];
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
            autoFailed.push({ id: effect.id, error: toErrorMessage(err) });
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

      await logAudit(ctx, { action: 'CALENDAR_EVENT_STATUS_UPDATE', targetType: 'CalendarEvent', targetId: input.id, result: 'SUCCESS', metadata: { status: input.status, oldStatus: event.status, title: event.title, calendarId: event.calendarId } });
      sseStore.pushToAll({ type: 'calendar-updated', seasonId: event.calendar.seasonId });
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

      return { event: result, autoApplied, autoFailed, pending, autoRolledBack, pendingRollback };
    }),

  // ─── Personal notes ─────────────────────────────────────────────────────────

  /**
   * Creates or updates a personal note on a calendar event for the current user.
   * Passing an empty body deletes the note.
   *
   * @auth season_calendar:read
   * @input CalendarEventPersonalNoteInputSchema
   * @output The upserted note, or null if deleted
   */
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

  /**
   * Deletes the current user's personal note on a calendar event.
   *
   * @auth season_calendar:read
   * @input { eventId }
   * @output { success: true }
   */
  deleteNote: protectedProcedure
    .use(requirePermission('season_calendar:read'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ eventId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      await deleteNote(input.eventId, ctx.session.user.id, ctx.prisma);
      return { success: true };
    }),

  // ─── Templates ──────────────────────────────────────────────────────────────

  /**
   * Lists all milestone templates.
   *
   * @auth milestone_template:read
   * @output Array of MilestoneTemplate
   */
  listTemplates: protectedProcedure
    .use(requirePermission('milestone_template:read'))
    .query(async ({ ctx }) => listTemplates(ctx.prisma)),

  /**
   * Applies a milestone template to a calendar, generating events at computed anchor-relative dates.
   *
   * Uses `input.anchorDate` if provided, otherwise falls back to the calendar's stored anchor date.
   * Requires `force: true` when the calendar already has events from this template.
   *
   * @auth season_calendar:update
   * @input { calendarId, templateId, anchorDate?, force }
   * @output Array of created CalendarEvent records
   */
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
        select: { brandId: true, seasonId: true, anchorDate: true },
      });
      if (!calendar) throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
      await assertBrandAccess(ctx.session.user.id, calendar.brandId, ctx.prisma);

      const anchor = input.anchorDate
        ? new Date(input.anchorDate)
        : (calendar.anchorDate ?? null);
      if (!anchor) throw new TRPCError({ code: 'BAD_REQUEST', message: 'anchorDate richiesta' });

      const result = await applyTemplate(input.calendarId, input.templateId, anchor, input.force, ctx.prisma);
      await logAudit(ctx, { action: 'SEASON_CALENDAR_APPLY_TEMPLATE', targetType: 'SeasonCalendar', targetId: input.calendarId, result: 'SUCCESS', metadata: { templateId: input.templateId, count: result.length } });
      sseStore.pushToAll({ type: 'calendar-updated', seasonId: calendar.seasonId });
      notifyCalendarChange(ctx.prisma, {
        eventIds: result.map(e => e.id),
        actorId: ctx.session.user.id,
        titleSuffix: 'ha applicato un template',
        message: `${result.length} eventi aggiunti al calendario`,
        calendarId: input.calendarId,
      }).catch(err => ctx.logger.error(err, 'calendar notification failed on apply template'));
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
    .input(z.object({ templateId: z.string().uuid() }).and(MilestoneTemplateItemInputSchema))
    .mutation(async ({ input, ctx }) => {
      const { templateId, ...data } = input;
      const result = await createTemplateItem(templateId, data, ctx.prisma);
      await logAudit(ctx, { action: 'MILESTONE_TEMPLATE_ITEM_CREATE', targetType: 'MilestoneTemplateItem', targetId: result.id, result: 'SUCCESS', metadata: { templateId } });
      return result;
    }),

  updateTemplateItem: protectedProcedure
    .use(requirePermission('milestone_template:update'))
    .input(z.object({ id: z.string().uuid() }).and(MilestoneTemplateItemBaseSchema.partial()))
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

  /**
   * Clones a season calendar (events and dependencies) from one brand/season to another.
   *
   * @auth season_calendar:update
   * @input CloneSeasonCalendarInputSchema
   * @output { calendarId, count }
   */
  cloneFromBrandSeason: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(CloneSeasonCalendarInputSchema)
    .mutation(async ({ input, ctx }) => {
      await assertBrandAccess(ctx.session.user.id, input.sourceBrandId, ctx.prisma);
      await assertBrandAccess(ctx.session.user.id, input.targetBrandId, ctx.prisma);

      const result = await cloneFromBrandSeason(input, ctx.prisma);
      await logAudit(ctx, { action: 'SEASON_CALENDAR_CLONE', targetType: 'SeasonCalendar', targetId: result.calendarId, result: 'SUCCESS', metadata: { sourceBrandId: input.sourceBrandId, sourceSeasonId: input.sourceSeasonId } });
      sseStore.pushToAll({ type: 'calendar-updated', seasonId: input.targetSeasonId });
      notifyCalendarChange(ctx.prisma, {
        eventIds: result.createdEventIds,
        actorId: ctx.session.user.id,
        titleSuffix: 'ha clonato il calendario',
        message: `${result.milestonesCreated} eventi copiati`,
        calendarId: result.calendarId,
      }).catch(err => ctx.logger.error(err, 'calendar notification failed on clone'));
      return result;
    }),

  // ─── Google sync ─────────────────────────────────────────────────────────────

  /**
   * Returns the Google Calendar sync status for a season calendar.
   *
   * @auth season_calendar:read
   * @input { calendarId }
   * @output Sync status details
   */
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

  /**
   * Triggers a full reconcile sync of the calendar with Google Calendar.
   *
   * @auth season_calendar:sync
   * @input { calendarId }
   * @output { triggered: true, ...syncResult }
   */
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

  /**
   * Grants one or more users explicit visibility on a calendar event.
   *
   * Only the owning function's members or admins can grant visibility.
   * Sends an in-app notification to each newly visible user.
   *
   * @auth season_calendar:update
   * @input CalendarEventUserVisibilityInputSchema
   * @output { ok: true }
   */
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
      await assertUnlocked('SEASON_CALENDAR', event.calendarId, ctx.session.user.id, ctx.prisma);

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

  /**
   * Duplicates a set of events (by id) into new events anchored to `rowIds` — used by the planning
   * wizard's row-fork to give the complement of a scoped subset its own copies of the remaining
   * events, from the fork point on.
   *
   * @auth season_calendar:update
   * @input { eventIds, rowIds }
   * @output Newly created CalendarEvent records (with visibilities/anchors), same shape as listMilestones
   */
  duplicateEventsFrom: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({
      eventIds: z.array(z.string().uuid()).min(1),
      rowIds: z.array(z.string().uuid()).min(1),
    }))
    .mutation(async ({ input, ctx }) => {
      const firstEvent = await ctx.prisma.calendarEvent.findUnique({
        where: { id: input.eventIds[0] },
        include: { calendar: { select: { brandId: true } } },
      });
      if (!firstEvent) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });
      await assertBrandAccess(ctx.session.user.id, firstEvent.calendar.brandId, ctx.prisma);
      await assertUnlocked('SEASON_CALENDAR', firstEvent.calendarId, ctx.session.user.id, ctx.prisma);

      const duplicates = await duplicateEventsFrom(input.eventIds, input.rowIds, ctx.prisma);
      await logAudit(ctx, {
        action: 'CALENDAR_EVENT_FORK_DUPLICATE',
        targetType: 'CalendarEvent',
        targetId: firstEvent.calendarId,
        result: 'SUCCESS',
        metadata: { sourceEventIds: input.eventIds, rowCount: input.rowIds.length, duplicateCount: duplicates.length },
      });
      duplicates.forEach(d => {
        syncOneMilestone(d.id, ctx.prisma, ctx.logger).catch(err => ctx.logger.error(err, 'gcal sync failed on fork duplicate'));
      });
      return duplicates;
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

  /**
   * Revokes explicit visibility on a calendar event for one or more users.
   *
   * Only the owning function's members or admins can revoke visibility.
   * Sends an in-app notification to each affected user.
   *
   * @auth season_calendar:update
   * @input { eventId, userIds }
   * @output { ok: true }
   */
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
