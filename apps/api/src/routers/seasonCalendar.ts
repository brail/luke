/**
 * tRPC router for season calendar management.
 *
 * Covers the full lifecycle of a seasonal planning calendar:
 *  - Calendar CRUD: getOrCreate, updateStatus
 *  - Milestones: listMilestones, createMilestone, updateMilestone, deleteMilestone(s),
 *                cancelMilestone, uncancelMilestone (admin-only)
 *  - Personal notes: upsertNote, deleteNote
 *  - Templates: listTemplates, applyTemplate (per planning group), createTemplate, updateTemplate,
 *               deleteTemplate, createTemplateItem, updateTemplateItem, deleteTemplateItem
 *  - Planning group freeze: freezePlanningGroup, unfreezePlanningGroup
 *  - Clone: cloneFromBrandSeason
 *  - Google Calendar sync: getSyncStatus, triggerSync
 *  - User visibility: grantUserVisibility, revokeUserVisibility
 *  - State effects: executeStateEffect, rollbackStateEffect
 *
 * PlanningGroup CRUD (create/list/rename/delete) lives in `planningGroup.ts`.
 * Brand access is enforced per-operation via `assertBrandAccess`.
 */

import { TRPCError } from '@trpc/server';
import { z } from 'zod';


import {
  CalendarEventBaseSchema,
  CloneSeasonCalendarInputSchema,
  CalendarEventPersonalNoteInputSchema,
  CalendarEventUserVisibilityInputSchema,
  ApplyTemplateInputSchema,
  MilestoneTemplateItemBaseSchema,
  SEASON_CALENDAR_STATUS,
  hasPermission,
  type Role,
} from '@luke/core';


import { logAudit } from '../lib/auditLog.js';
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
  resolvePlanningGroupWithBrandAccess,
  filterAllowedBrandIds,
  getOrCreateCalendar,
  updateCalendarStatus,
  freezePlanningGroup,
  unfreezePlanningGroup,
  listMilestonesDb,
  createMilestone,
  updateMilestone,
  deleteMilestone,
  rescheduleMilestone,
  isEventDateLocked,
  isEventDeleteLocked,
  detectPhaseOrderWarning,
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

import type { PrismaClient } from '@prisma/client';

/**
 * Appends the non-blocking phase-order sanity check to a create/update/reschedule result, running it
 * alongside the mutation's audit log write (independent reads/writes, no ordering dependency between them).
 */
async function withPhaseOrderWarning<T extends { id: string }>(result: T, prisma: PrismaClient, auditLog: Promise<void>) {
  const [, phaseOrderWarning] = await Promise.all([auditLog, detectPhaseOrderWarning(result.id, prisma)]);
  return { ...result, phaseOrderWarning };
}

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
   * Freezes a planning group's baseline: snapshots every one of its events' current startAt/endAt
   * into baselineStartAt/baselineEndAt, written once. startAt/endAt remain freely editable afterwards.
   *
   * @auth season_calendar:freeze
   * @input { planningGroupId }
   * @output Updated PlanningGroup
   */
  freezePlanningGroup: protectedProcedure
    .use(requirePermission('season_calendar:freeze'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ planningGroupId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const group = await resolvePlanningGroupWithBrandAccess(input.planningGroupId, ctx.session.user.id, ctx.prisma);
      await assertUnlocked('SEASON_CALENDAR', group.calendarId, ctx.session.user.id, ctx.prisma);
      const result = await freezePlanningGroup(input.planningGroupId, ctx.prisma);
      await logAudit(ctx, { action: 'PLANNING_GROUP_FROZEN', targetType: 'PlanningGroup', targetId: input.planningGroupId, result: 'SUCCESS', metadata: {} });
      sseStore.pushToAll({ type: 'calendar-updated', seasonId: group.calendar.seasonId });
      return result;
    }),

  /**
   * Admin-only: reverts a freeze, clearing the group's `frozenAt` and every one of its events'
   * baseline snapshot. Used to correct an accidental or premature freeze.
   *
   * @auth season_calendar:unfreeze (admin wildcard only — not granted to editor/viewer)
   * @input { planningGroupId }
   * @output Updated PlanningGroup
   */
  unfreezePlanningGroup: protectedProcedure
    .use(requirePermission('season_calendar:unfreeze'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ planningGroupId: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const group = await resolvePlanningGroupWithBrandAccess(input.planningGroupId, ctx.session.user.id, ctx.prisma);
      const result = await unfreezePlanningGroup(input.planningGroupId, ctx.prisma);
      await logAudit(ctx, { action: 'PLANNING_GROUP_UNFROZEN', targetType: 'PlanningGroup', targetId: input.planningGroupId, result: 'SUCCESS', metadata: {} });
      sseStore.pushToAll({ type: 'calendar-updated', seasonId: group.calendar.seasonId });
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
   * @input CalendarEventBaseSchema
   * @output The created CalendarEvent
   */
  createMilestone: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(CalendarEventBaseSchema)
    .mutation(async ({ input, ctx }) => {
      const group = await resolvePlanningGroupWithBrandAccess(input.planningGroupId, ctx.session.user.id, ctx.prisma);
      await assertUnlocked('SEASON_CALENDAR', group.calendarId, ctx.session.user.id, ctx.prisma);

      const result = await createMilestone(input, group.calendarId, ctx.prisma);
      sseStore.pushToAll({ type: 'calendar-updated', seasonId: group.calendar.seasonId });
      notifyCalendarChange(ctx.prisma, {
        eventId: result.id,
        actorId: ctx.session.user.id,
        titleSuffix: 'ha aggiunto un evento',
        message: `"${result.title}"`,
        calendarId: group.calendarId,
      }).catch(err => ctx.logger.error(err, 'calendar notification failed on create'));
      syncOneMilestone(result.id, ctx.prisma, ctx.logger).catch(err => ctx.logger.error(err, 'gcal sync failed on create'));
      return withPhaseOrderWarning(result, ctx.prisma, logAudit(ctx, { action: 'CALENDAR_EVENT_CREATE', targetType: 'CalendarEvent', targetId: result.id, result: 'SUCCESS', metadata: { calendarId: group.calendarId, planningGroupId: input.planningGroupId, title: result.title } }));
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
      data: CalendarEventBaseSchema.partial().omit({ planningGroupId: true }),
    }))
    .mutation(async ({ input, ctx }) => {
      const event = await ctx.prisma.calendarEvent.findUnique({
        where: { id: input.id },
        include: { calendar: { select: { brandId: true, seasonId: true } }, planningGroup: { select: { frozenAt: true } } },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });
      if (event.cancelledAt) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Evento annullato: è di sola lettura. Un admin deve ripristinarlo prima di modificarlo.' });
      }
      await Promise.all([
        assertBrandAccess(ctx.session.user.id, event.calendar.brandId, ctx.prisma),
        assertUnlocked('SEASON_CALENDAR', event.calendarId, ctx.session.user.id, ctx.prisma),
      ]);

      // A frozen, already-passed phase event is locked: date moves would launder a real delay out of
      // the alert engine, and renaming or reassigning the phase would rewrite what the frozen baseline
      // committed to. Date has a motivated escape hatch (`rescheduleMilestone`); title/phaseId don't —
      // only unfreezing the group lifts the lock. Other edits (owner, description, …) stay allowed.
      const changesDate =
        (input.data.startAt !== undefined && new Date(input.data.startAt).getTime() !== event.startAt.getTime())
        || (input.data.endAt !== undefined && (input.data.endAt ? new Date(input.data.endAt).getTime() : null) !== (event.endAt?.getTime() ?? null));
      const changesTitle = input.data.title !== undefined && input.data.title !== event.title;
      const changesPhase = input.data.phaseId !== undefined && input.data.phaseId !== event.phaseId;
      if ((changesDate || changesTitle || changesPhase) && isEventDateLocked(event)) {
        const lockedFields = [
          changesDate && 'la data (usa uno spostamento motivato)',
          changesTitle && 'il titolo',
          changesPhase && 'la fase',
        ].filter(Boolean).join(', ');
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Evento di fase congelato e già passato: non è possibile modificare ${lockedFields}.`,
        });
      }

      const result = await updateMilestone(input.id, input.data, ctx.prisma);

      const dateChanged = event.startAt.getTime() !== result.startAt.getTime()
        || (event.endAt?.getTime() ?? null) !== (result.endAt?.getTime() ?? null);
      const FIELD_LABELS: Record<string, string> = {
        description: 'Descrizione',
        publishExternally: 'Sincronizzazione Google', templateItemId: 'Template',
        allDay: 'Giornata intera',
      };
      const changedFields = Object.keys(FIELD_LABELS).filter(
        k => JSON.stringify((event as Record<string, unknown>)[k]) !== JSON.stringify((result as Record<string, unknown>)[k])
      ).map(k => FIELD_LABELS[k]);

      sseStore.pushToAll({ type: 'calendar-updated', seasonId: event.calendar.seasonId });
      notifyCalendarChange(ctx.prisma, {
        eventId: input.id,
        actorId: ctx.session.user.id,
        titleSuffix: 'ha modificato un evento',
        message: `"${result.title}"`,
        calendarId: event.calendarId,
      }).catch(err => ctx.logger.error(err, 'calendar notification failed on update'));
      syncOneMilestone(input.id, ctx.prisma, ctx.logger).catch(err => ctx.logger.error(err, 'gcal sync failed on update'));
      return withPhaseOrderWarning(result, ctx.prisma, logAudit(ctx, {
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
      }));
    }),

  /**
   * Motivated in-place reschedule of an event's dates — the only way to move a frozen, already-passed
   * phase event (see `isEventDateLocked`). Only `startAt`/`endAt` change; the frozen baseline is left
   * intact so scheduling variance keeps measuring against the original plan. The reason is mandatory
   * and recorded in the audit log alongside the old/new dates.
   *
   * @auth season_calendar:update
   * @input { id, startAt, endAt?, reason }
   * @output Updated CalendarEvent
   */
  rescheduleMilestone: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({
      id: z.string().uuid(),
      startAt: z.string().datetime(),
      endAt: z.string().datetime().optional().nullable(),
      reason: z.string().min(1, 'Motivazione obbligatoria').max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      const event = await ctx.prisma.calendarEvent.findUnique({
        where: { id: input.id },
        include: { calendar: { select: { brandId: true, seasonId: true } } },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });
      if (event.cancelledAt) throw new TRPCError({ code: 'CONFLICT', message: 'Evento annullato: non può essere spostato' });
      await Promise.all([
        assertBrandAccess(ctx.session.user.id, event.calendar.brandId, ctx.prisma),
        assertUnlocked('SEASON_CALENDAR', event.calendarId, ctx.session.user.id, ctx.prisma),
      ]);

      const result = await rescheduleMilestone(input.id, input.startAt, input.endAt, ctx.prisma);

      sseStore.pushToAll({ type: 'calendar-updated', seasonId: event.calendar.seasonId });
      notifyCalendarChange(ctx.prisma, {
        eventId: input.id,
        actorId: ctx.session.user.id,
        titleSuffix: 'ha spostato un evento',
        message: `"${result.title}" — ${input.reason}`,
        calendarId: event.calendarId,
      }).catch(err => ctx.logger.error(err, 'calendar notification failed on reschedule'));
      syncOneMilestone(input.id, ctx.prisma, ctx.logger).catch(err => ctx.logger.error(err, 'gcal sync failed on reschedule'));
      return withPhaseOrderWarning(result, ctx.prisma, logAudit(ctx, {
        action: 'CALENDAR_EVENT_RESCHEDULE', targetType: 'CalendarEvent', targetId: input.id, result: 'SUCCESS',
        metadata: {
          title: result.title, calendarId: event.calendarId, reason: input.reason,
          oldStartAt: event.startAt.toISOString(), newStartAt: result.startAt.toISOString(),
          oldEndAt: event.endAt?.toISOString() ?? null, newEndAt: result.endAt?.toISOString() ?? null,
        },
      }));
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
        include: { calendar: { select: { brandId: true, seasonId: true } }, planningGroup: { select: { frozenAt: true } } },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });
      if (event.cancelledAt) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Evento annullato: è di sola lettura. Un admin deve ripristinarlo prima di eliminarlo.' });
      }
      await Promise.all([
        assertBrandAccess(ctx.session.user.id, event.calendar.brandId, ctx.prisma),
        assertUnlocked('SEASON_CALENDAR', event.calendarId, ctx.session.user.id, ctx.prisma),
      ]);

      // A frozen phase event carries a baseline commitment + variance history — hard delete would
      // destroy them. Retire it with `cancelMilestone` instead (keeps it in history).
      if (isEventDeleteLocked(event)) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Evento di fase congelato: usa Annulla invece di Elimina per conservarne lo storico.',
        });
      }

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
        include: { calendar: { select: { brandId: true, seasonId: true } }, planningGroup: { select: { frozenAt: true } } },
      });
      const uniqueBrandIds = [...new Set(events.map(e => e.calendar.brandId).filter((id): id is string => id != null))];
      const calendarIdsToLockCheck = [...new Set(events.map(e => e.calendarId))];
      await Promise.all([
        ...uniqueBrandIds.map(brandId => assertBrandAccess(ctx.session.user.id, brandId, ctx.prisma)),
        ...calendarIdsToLockCheck.map(id => assertUnlocked('SEASON_CALENDAR', id, ctx.session.user.id, ctx.prisma)),
      ]);

      // Same frozen-phase protection as single delete: block the whole batch if any is a frozen
      // commitment — those must be cancelled, not hard-deleted.
      const lockedCount = events.filter(isEventDeleteLocked).length;
      if (lockedCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `${lockedCount} evento/i di fase congelati nella selezione: annullali invece di eliminarli.`,
        });
      }
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
   * Cancels a calendar event with a mandatory reason — the only lifecycle transition an event has
   * (there is no PLANNED/IN_PROGRESS/COMPLETED; completion is row-driven, see
   * CollectionRowPhaseHistory). A cancelled event is retired from the alert engine and frees its
   * (planningGroup, phase) uniqueness slot, but is kept for audit. Any still-active state effects it
   * applied (e.g. a collection-layout lock) are rolled back so a cancelled event never keeps holding
   * a lock. Re-cancelling an already-cancelled event conflicts.
   *
   * @auth season_calendar:update
   * @input { id, reason }
   * @output { event, rolledBack }
   */
  cancelMilestone: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(z.object({
      id: z.string().uuid(),
      reason: z.string().min(1, 'Motivazione obbligatoria').max(500),
    }))
    .mutation(async ({ input, ctx }) => {
      const event = await ctx.prisma.calendarEvent.findUnique({
        where: { id: input.id },
        include: { calendar: { select: { brandId: true, seasonId: true } } },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });
      if (event.cancelledAt) throw new TRPCError({ code: 'CONFLICT', message: 'Evento già annullato' });
      await Promise.all([
        assertBrandAccess(ctx.session.user.id, event.calendar.brandId, ctx.prisma),
        assertUnlocked('SEASON_CALENDAR', event.calendarId, ctx.session.user.id, ctx.prisma),
      ]);

      const result = await ctx.prisma.calendarEvent.update({
        where: { id: input.id },
        data: { cancelledAt: new Date(), cancelReason: input.reason, cancelledByUserId: ctx.session.user.id },
      });

      // Release any still-active state effects (e.g. layout locks): a cancelled event must not keep
      // holding a lock. Confirmation-required executions are rolled back too — the event is retired.
      const rolledBack: string[] = [];
      const executions = await ctx.prisma.calendarEventEffectExecution.findMany({
        where: { eventId: input.id, rolledBackAt: null },
        select: { id: true },
      });
      await Promise.all(executions.map(async exec => {
        try {
          await rollbackEffect(ctx.prisma, exec.id, ctx.session.user.id);
          rolledBack.push(exec.id);
        } catch (err) {
          ctx.logger.error(err, `cancel rollback failed: ${exec.id}`);
        }
      }));

      await logAudit(ctx, { action: 'CALENDAR_EVENT_CANCEL', targetType: 'CalendarEvent', targetId: input.id, result: 'SUCCESS', metadata: { title: event.title, calendarId: event.calendarId, reason: input.reason } });
      sseStore.pushToAll({ type: 'calendar-updated', seasonId: event.calendar.seasonId });
      syncOneMilestone(input.id, ctx.prisma, ctx.logger).catch(err => ctx.logger.error(err, 'gcal sync failed on cancel'));

      void getVisibleUserIdsForMilestone(input.id, ctx.prisma)
        .then(async userIds => {
          const batchSize = 10;
          for (let i = 0; i < userIds.length; i += batchSize) {
            await Promise.allSettled(
              userIds.slice(i, i + batchSize).map(userId =>
                createNotification(ctx.prisma, {
                  userId,
                  category: 'CALENDAR',
                  title: 'Evento annullato',
                  message: `"${event.title}" annullato: ${input.reason}`,
                  link: '/calendar',
                  data: { eventId: input.id, cancelled: true },
                }).catch(e => ctx.logger.error({ err: e, userId }, 'notification failed on event cancel'))
              )
            );
          }
        })
        .catch(err => ctx.logger.error(err, 'notification fanout failed on event cancel'));

      return { event: result, rolledBack };
    }),

  /**
   * Reverses `cancelMilestone`, restoring the event to active and read-write. Admin-only — an
   * editor who can cancel an event cannot undo that decision, mirroring the `freeze`/`unfreeze`
   * asymmetry. Rejects if another active event has since taken the (planningGroup, phase) slot
   * (the partial unique index would otherwise throw a raw constraint error). Does NOT re-apply
   * state effects that were rolled back on cancel (e.g. a collection-layout lock) — that is a
   * separate trigger mechanism, not something to replay blindly here.
   *
   * @auth season_calendar:uncancel (admin wildcard only — not granted to editor/viewer)
   * @input { id }
   * @output Updated CalendarEvent
   */
  uncancelMilestone: protectedProcedure
    .use(requirePermission('season_calendar:uncancel'))
    .use(withRateLimit('configMutations'))
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input, ctx }) => {
      const event = await ctx.prisma.calendarEvent.findUnique({
        where: { id: input.id },
        include: { calendar: { select: { brandId: true, seasonId: true } }, phase: { select: { label: true } } },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });
      if (!event.cancelledAt) throw new TRPCError({ code: 'CONFLICT', message: 'Evento non è annullato' });
      await Promise.all([
        assertBrandAccess(ctx.session.user.id, event.calendar.brandId, ctx.prisma),
        assertUnlocked('SEASON_CALENDAR', event.calendarId, ctx.session.user.id, ctx.prisma),
      ]);

      if (event.phaseId) {
        const conflicting = await ctx.prisma.calendarEvent.findFirst({
          where: { planningGroupId: event.planningGroupId, phaseId: event.phaseId, cancelledAt: null, id: { not: event.id } },
          select: { title: true },
        });
        if (conflicting) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: `Impossibile ripristinare: la fase "${event.phase?.label ?? event.phaseId}" è già assegnata all'evento attivo "${conflicting.title}". Annulla o riassegna quell'evento prima di ripristinare questo.`,
          });
        }
      }

      const result = await ctx.prisma.calendarEvent.update({
        where: { id: input.id },
        data: { cancelledAt: null, cancelReason: null, cancelledByUserId: null },
      });

      await logAudit(ctx, { action: 'CALENDAR_EVENT_UNCANCEL', targetType: 'CalendarEvent', targetId: input.id, result: 'SUCCESS', metadata: { title: event.title, calendarId: event.calendarId } });
      sseStore.pushToAll({ type: 'calendar-updated', seasonId: event.calendar.seasonId });
      syncOneMilestone(input.id, ctx.prisma, ctx.logger).catch(err => ctx.logger.error(err, 'gcal sync failed on uncancel'));
      notifyCalendarChange(ctx.prisma, {
        eventId: input.id,
        actorId: ctx.session.user.id,
        titleSuffix: 'ha ripristinato un evento annullato',
        message: `"${event.title}"`,
        calendarId: event.calendarId,
      }).catch(err => ctx.logger.error(err, 'calendar notification failed on uncancel'));

      return result;
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
   * Applies a milestone template to a planning group, generating events at computed
   * anchor-relative dates, all stamped with that group's id.
   *
   * Uses `input.anchorDate` if provided, otherwise falls back to the group's stored anchor date
   * (set by a previous apply). Requires `force: true` when the group already has events.
   *
   * @auth season_calendar:update
   * @input { planningGroupId, templateId, anchorDate?, force }
   * @output Array of created CalendarEvent records
   */
  applyTemplate: protectedProcedure
    .use(requirePermission('season_calendar:update'))
    .use(withRateLimit('configMutations'))
    .input(ApplyTemplateInputSchema)
    .mutation(async ({ input, ctx }) => {
      const group = await resolvePlanningGroupWithBrandAccess(input.planningGroupId, ctx.session.user.id, ctx.prisma);

      const anchor = input.anchorDate
        ? new Date(input.anchorDate)
        : (group.anchorDate ?? null);
      if (!anchor) throw new TRPCError({ code: 'BAD_REQUEST', message: 'anchorDate richiesta' });

      const result = await applyTemplate(input.planningGroupId, input.templateId, anchor, input.force, ctx.prisma);
      await logAudit(ctx, { action: 'PLANNING_GROUP_APPLY_TEMPLATE', targetType: 'PlanningGroup', targetId: input.planningGroupId, result: 'SUCCESS', metadata: { templateId: input.templateId, count: result.length } });
      sseStore.pushToAll({ type: 'calendar-updated', seasonId: group.calendar.seasonId });
      notifyCalendarChange(ctx.prisma, {
        eventIds: result.map(e => e.id),
        actorId: ctx.session.user.id,
        titleSuffix: 'ha applicato un template',
        message: `${result.length} eventi aggiunti al calendario`,
        calendarId: group.calendarId,
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
    .input(z.object({ templateId: z.string().uuid() }).and(MilestoneTemplateItemBaseSchema))
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
      await logAudit(ctx, { action: 'SEASON_CALENDAR_CLONE', targetType: 'SeasonCalendar', targetId: result.calendarId, result: 'SUCCESS', metadata: { sourceBrandId: input.sourceBrandId, sourceSeasonId: input.sourceSeasonId, sourcePlanningGroupIds: input.sourcePlanningGroupIds } });
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
        select: { title: true },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });

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
        select: { title: true },
      });
      if (!event) throw new TRPCError({ code: 'NOT_FOUND', message: 'Evento non trovato' });

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
