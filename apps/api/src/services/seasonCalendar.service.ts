import { TRPCError } from '@trpc/server';

import {
  eventDeadline,
  isEventDateLocked as isEventDateLockedCore,
  isEventDeleteLocked as isEventDeleteLockedCore,
  type CalendarEventInput,
  type CloneSeasonCalendarInput,
  type Role,
} from '@luke/core';

import { getUserAllowedBrandIds } from './context.service.js';

import type { CalendarDaysRelevance, PrismaClient } from '@prisma/client';

const MS_PER_DAY = 86_400_000;

// ─── Brand access helper ──────────────────────────────────────────────────────

/**
 * Throws FORBIDDEN if the user does not have access to the given brand.
 * Admins (allowed === null) always pass.
 */
export async function assertBrandAccess(
  userId: string,
  brandId: string,
  prisma: PrismaClient,
  userRole?: Role
): Promise<void> {
  const allowed = await getUserAllowedBrandIds(userId, prisma, userRole);
  if (allowed !== null && !allowed.includes(brandId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Accesso al brand negato' });
  }
}

/**
 * Resolves a PlanningGroup and asserts the user has brand access to it.
 *
 * @throws {TRPCError} NOT_FOUND if the group does not exist.
 * @throws {TRPCError} FORBIDDEN if the user lacks brand access.
 */
export async function resolvePlanningGroupWithBrandAccess(
  planningGroupId: string,
  userId: string,
  prisma: PrismaClient
) {
  const group = await prisma.planningGroup.findUnique({
    where: { id: planningGroupId },
    select: { calendarId: true, anchorDate: true, calendar: { select: { brandId: true, seasonId: true } } },
  });
  if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'Gruppo di pianificazione non trovato' });
  await assertBrandAccess(userId, group.calendar.brandId, prisma);
  return group;
}

/**
 * Filters a list of brand IDs to those the user is allowed to access.
 * Returns the original list unchanged for admins (no restrictions).
 */
export async function filterAllowedBrandIds(
  userId: string,
  requestedBrandIds: string[],
  prisma: PrismaClient,
  userRole?: Role
): Promise<string[]> {
  const allowed = await getUserAllowedBrandIds(userId, prisma, userRole);
  if (allowed === null) return requestedBrandIds;
  return requestedBrandIds.filter(id => allowed.includes(id));
}

// ─── Calendar get/create ──────────────────────────────────────────────────────

/**
 * Resolves the id of a brand+season's default PlanningGroup, creating the SeasonCalendar and/or the
 * default group if either doesn't exist yet. Does not open its own transaction — safe to call with
 * either the plain PrismaClient or an interactive transaction client, so callers already inside a
 * transaction (e.g. `collectionLayout.rows.create`) can use it without nesting `$transaction` calls.
 */
async function ensureDefaultPlanningGroup(calendarId: string, prisma: PrismaClient): Promise<string> {
  const existing = await prisma.planningGroup.findFirst({
    where: { calendarId, isDefault: true },
  });
  if (existing) return existing.id;
  const created = await prisma.planningGroup.create({
    data: { calendarId, name: 'Predefinito', isDefault: true },
  });
  return created.id;
}

/** Shared upsert shape for "find or create the brand+season calendar" — spread in an `include` where needed. */
function calendarUpsertArgs(brandId: string, seasonId: string) {
  return {
    where: { brandId_seasonId: { brandId, seasonId } },
    create: { brandId, seasonId },
    update: {},
  } as const;
}

export async function resolveDefaultPlanningGroupId(
  brandId: string,
  seasonId: string,
  prisma: PrismaClient
): Promise<string> {
  const calendar = await prisma.seasonCalendar.upsert(calendarUpsertArgs(brandId, seasonId));
  return ensureDefaultPlanningGroup(calendar.id, prisma);
}

/**
 * Returns the SeasonCalendar for the given brand+season, creating it if it does not exist.
 * Also ensures the calendar's default PlanningGroup exists (auto-created, never renamed/deleted).
 * Includes brand/season metadata and event count.
 */
export async function getOrCreateCalendar(
  brandId: string,
  seasonId: string,
  prisma: PrismaClient
) {
  return prisma.$transaction(async tx => {
    const calendar = await tx.seasonCalendar.upsert({
      ...calendarUpsertArgs(brandId, seasonId),
      include: {
        brand: { select: { code: true, name: true } },
        season: { select: { code: true, name: true, year: true } },
        _count: { select: { events: true } },
      },
    });

    await ensureDefaultPlanningGroup(calendar.id, tx as unknown as PrismaClient);

    return calendar;
  });
}

/**
 * Updates the status of a SeasonCalendar (DRAFT | ACTIVE | ARCHIVED).
 */
export async function updateCalendarStatus(
  calendarId: string,
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED',
  prisma: PrismaClient
) {
  return prisma.seasonCalendar.update({ where: { id: calendarId }, data: { status } });
}

/**
 * Freezes a PlanningGroup's baseline: snapshots the current startAt/endAt of every event belonging
 * to it into baselineStartAt/baselineEndAt (written once, never updated afterwards), then sets
 * frozenAt. startAt/endAt remain freely editable after freeze — only the baseline snapshot is
 * immutable. Events added to the group after freeze simply keep a null baseline (excluded from
 * scheduling-variance comparisons) — freeze is never retroactively re-applied.
 *
 * @throws {TRPCError} NOT_FOUND if the planning group does not exist.
 * @throws {TRPCError} CONFLICT if the group was already frozen (re-freeze is not supported — the
 *   baseline must reflect the plan "as it was" at first freeze, never a later re-snapshot).
 */
export async function freezePlanningGroup(planningGroupId: string, prisma: PrismaClient) {
  return prisma.$transaction(async tx => {
    const group = await tx.planningGroup.findUnique({ where: { id: planningGroupId } });
    if (!group) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Gruppo di pianificazione non trovato' });
    }
    if (group.frozenAt) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Gruppo di pianificazione già congelato' });
    }

    const events = await tx.calendarEvent.findMany({
      where: { planningGroupId },
      select: { id: true, startAt: true, endAt: true },
    });

    await Promise.all(
      events.map(event =>
        tx.calendarEvent.update({
          where: { id: event.id },
          data: { baselineStartAt: event.startAt, baselineEndAt: event.endAt },
        })
      )
    );

    return tx.planningGroup.update({
      where: { id: planningGroupId },
      data: { frozenAt: new Date() },
    });
  });
}

/**
 * Reverts `freezePlanningGroup`: clears the group's `frozenAt` and every one of its events' baseline
 * snapshot. Admin-only procedure (gated by `season_calendar:unfreeze`, granted only to the admin
 * wildcard) to correct an accidental or premature freeze — not a normal planning operation.
 *
 * @throws {TRPCError} NOT_FOUND if the planning group does not exist.
 * @throws {TRPCError} CONFLICT if the group is not currently frozen.
 */
export async function unfreezePlanningGroup(planningGroupId: string, prisma: PrismaClient) {
  return prisma.$transaction(async tx => {
    const group = await tx.planningGroup.findUnique({ where: { id: planningGroupId } });
    if (!group) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Gruppo di pianificazione non trovato' });
    }
    if (!group.frozenAt) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Gruppo di pianificazione non è congelato' });
    }

    await tx.calendarEvent.updateMany({
      where: { planningGroupId },
      data: { baselineStartAt: null, baselineEndAt: null },
    });

    return tx.planningGroup.update({
      where: { id: planningGroupId },
      data: { frozenAt: null },
    });
  });
}

// ─── Post-freeze immutability (project_calendar_event_maintainability, Fase 4) ──

/** Minimal shape needed to evaluate whether a calendar event is post-freeze locked. */
type LockableEvent = {
  phaseId: string | null;
  startAt: Date;
  endAt: Date | null;
  planningGroup: { frozenAt: Date | null };
};

/**
 * Thin adapter over the shared `@luke/core` predicate — only reshapes the server's nested
 * `planningGroup.frozenAt` into the flat `frozenAt` the shared function expects. The actual lock
 * logic lives in one place so the server and the client UX mirror (`apps/web/.../calendar/utils.ts`)
 * can't drift on what "locked" means. The only way to move a locked event is a *motivated* reschedule
 * (`rescheduleMilestone`, reason audited) — title/phaseId have no equivalent path, only unfreezing
 * the group lifts the lock.
 */
export function isEventDateLocked(event: LockableEvent, now: Date = new Date()): boolean {
  return isEventDateLockedCore({ phaseId: event.phaseId, frozenAt: event.planningGroup.frozenAt, startAt: event.startAt, endAt: event.endAt }, now);
}

/** Thin adapter over the shared `@luke/core` predicate — see `isEventDateLocked` above. */
export function isEventDeleteLocked(event: LockableEvent): boolean {
  return isEventDeleteLockedCore({ phaseId: event.phaseId, frozenAt: event.planningGroup.frozenAt });
}

/**
 * Motivated in-place move of a locked (or any) event's dates. Only `startAt`/`endAt` change — the
 * frozen baseline is never touched, so scheduling variance keeps measuring against the original plan
 * while the alert countdown follows the new target. The reason is captured in the audit log by the caller.
 */
export async function rescheduleMilestone(
  eventId: string,
  startAt: string,
  endAt: string | null | undefined,
  prisma: PrismaClient,
  allDay?: boolean
) {
  return prisma.calendarEvent.update({
    where: { id: eventId },
    data: {
      startAt: new Date(startAt),
      endAt: endAt ? new Date(endAt) : null,
      ...(allDay !== undefined && { allDay }),
    },
  });
}

/**
 * Non-blocking sanity check (project_calendar_event_maintainability, Fase 6): flags when a phase
 * event's date is out of order relative to its sibling phase events in the same planning group — an
 * earlier phase scheduled after a later one, or vice versa. Returns a human message or null. This is
 * a soft warning surfaced on save (toast); it does NOT block, and reintroduces no phase dependency
 * graph (the what-if solver stays removed) — it only compares `Phase.order` against `endAt ?? startAt`.
 */
export async function detectPhaseOrderWarning(eventId: string, prisma: PrismaClient): Promise<string | null> {
  const event = await prisma.calendarEvent.findUnique({
    where: { id: eventId },
    select: { planningGroupId: true, cancelledAt: true, startAt: true, endAt: true, phase: { select: { order: true, label: true } } },
  });
  if (!event || event.cancelledAt || !event.phase) return null;

  const deadline = eventDeadline(event);
  const siblings = await prisma.calendarEvent.findMany({
    where: { planningGroupId: event.planningGroupId, cancelledAt: null, phaseId: { not: null }, id: { not: eventId } },
    select: { startAt: true, endAt: true, phase: { select: { order: true, label: true } } },
  });

  for (const s of siblings) {
    if (!s.phase) continue;
    const sDeadline = eventDeadline(s);
    if (s.phase.order < event.phase.order && sDeadline > deadline) {
      return `Ordine fasi incoerente: la fase precedente «${s.phase.label}» è pianificata dopo «${event.phase.label}».`;
    }
    if (s.phase.order > event.phase.order && sDeadline < deadline) {
      return `Ordine fasi incoerente: la fase successiva «${s.phase.label}» è pianificata prima di «${event.phase.label}».`;
    }
  }
  return null;
}

// ─── Milestone list ───────────────────────────────────────────────────────────

/**
 * Returns calendar events for the given season and brands, enriched with the caller's personal note.
 *
 * @param functionId - When provided, only events visible to this company function are returned.
 */
export async function listMilestonesDb(
  seasonId: string,
  brandIds: string[],
  userId: string,
  prisma: PrismaClient,
  functionId?: string
) {
  const calendars = await prisma.seasonCalendar.findMany({
    where: { seasonId, brandId: { in: brandIds } },
    select: { id: true, brandId: true },
  });
  const calendarIds = calendars.map(c => c.id);
  const calendarBrandMap = new Map(calendars.map(c => [c.id, c.brandId]));

  const events = await prisma.calendarEvent.findMany({
    where: {
      calendarId: { in: calendarIds },
      ...(functionId
        ? { visibilities: { some: { functionId } } }
        : {}),
    },
    include: {
      visibilities: true,
      notes: { where: { userId }, take: 1 },
      planningGroup: { select: { id: true, name: true, frozenAt: true } },
    },
    orderBy: { startAt: 'asc' },
  });

  return events.map(({ planningGroup, ...e }) => ({
    ...e,
    brandId: calendarBrandMap.get(e.calendarId) ?? null,
    planningGroupName: planningGroup.name,
    // Surfaced so the client can compute post-freeze date-lock (see isEventDateLocked) without a
    // second round-trip: a phase event whose group is frozen and whose deadline has passed is locked.
    planningGroupFrozenAt: planningGroup.frozenAt,
  }));
}

// ─── Milestone create/update/delete ──────────────────────────────────────────

/**
 * Creates a calendar event and its visibility entries within a single transaction.
 * The owner function always receives a read-write visibility; all others are read-only.
 *
 * @param calendarId - The planning group's calendar id, already resolved by the caller (e.g. via
 *   `resolvePlanningGroupWithBrandAccess`) — a group's calendar is immutable once created, so
 *   there's no staleness risk in reusing it instead of re-fetching the group here.
 */
export async function createMilestone(
  input: CalendarEventInput,
  calendarId: string,
  prisma: PrismaClient
) {
  return prisma.$transaction(async tx => {
    const event = await tx.calendarEvent.create({
      data: {
        calendarId,
        planningGroupId: input.planningGroupId,
        phaseId: input.phaseId,
        calendarDaysRelevance: input.calendarDaysRelevance,
        title: input.title,
        description: input.description,
        startAt: new Date(input.startAt),
        endAt: input.endAt ? new Date(input.endAt) : undefined,
        allDay: input.allDay,
        publishExternally: input.publishExternally,
        templateItemId: input.templateItemId,
      },
    });

    await tx.calendarEventVisibility.createMany({
      data: input.visibilityFunctionIds.map(fId => ({
        eventId: event.id,
        functionId: fId,
      })),
    });

    return event;
  });
}

/**
 * Partially updates a calendar event. When `visibilityFunctionIds` is provided,
 * existing visibility entries are replaced atomically within a transaction.
 */
export async function updateMilestone(
  eventId: string,
  input: Partial<CalendarEventInput>,
  prisma: PrismaClient
) {
  return prisma.$transaction(async tx => {
    const updated = await tx.calendarEvent.update({
      where: { id: eventId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.phaseId !== undefined ? { phaseId: input.phaseId } : {}),
        ...(input.calendarDaysRelevance !== undefined ? { calendarDaysRelevance: input.calendarDaysRelevance } : {}),
        ...(input.startAt !== undefined ? { startAt: new Date(input.startAt) } : {}),
        ...(input.endAt !== undefined ? { endAt: new Date(input.endAt) } : {}),
        ...(input.allDay !== undefined ? { allDay: input.allDay } : {}),
        ...(input.publishExternally !== undefined ? { publishExternally: input.publishExternally } : {}),
      },
    });

    if (input.visibilityFunctionIds) {
      await tx.calendarEventVisibility.deleteMany({ where: { eventId } });
      await tx.calendarEventVisibility.createMany({
        data: input.visibilityFunctionIds.map(fId => ({
          eventId,
          functionId: fId,
        })),
      });
    }

    return updated;
  });
}

/**
 * Hard-deletes a calendar event and its related records (cascade).
 */
export async function deleteMilestone(eventId: string, prisma: PrismaClient): Promise<void> {
  await prisma.calendarEvent.delete({ where: { id: eventId } });
}

// ─── Note ────────────────────────────────────────────────────────────────────

/**
 * Creates or updates the caller's personal note on a calendar event.
 */
export async function upsertNote(
  eventId: string,
  userId: string,
  body: string,
  prisma: PrismaClient
) {
  return prisma.calendarEventPersonalNote.upsert({
    where: { eventId_userId: { eventId, userId } },
    create: { eventId, userId, body },
    update: { body },
  });
}

/**
 * Deletes the caller's personal note on a calendar event, if any.
 */
export async function deleteNote(
  eventId: string,
  userId: string,
  prisma: PrismaClient
): Promise<void> {
  await prisma.calendarEventPersonalNote.deleteMany({ where: { eventId, userId } });
}

// ─── Template ─────────────────────────────────────────────────────────────────

/**
 * Returns all milestone templates with their items (sorted by offsetDays) and item visibilities.
 */
export async function listTemplates(prisma: PrismaClient) {
  return prisma.milestoneTemplate.findMany({
    include: {
      items: {
        orderBy: { offsetDays: 'asc' },
        include: {
          visibilities: true,
        },
      },
    },
    orderBy: { name: 'asc' },
  });
}

/**
 * Materializes a milestone template onto a planning group anchored at `anchorDate`.
 * Creates events and visibility entries within a transaction, stamping each created event with the
 * group's id — that's what makes them applicable only to the rows of the same group.
 *
 * @param force - When false, throws CONFLICT if the planning group already has events.
 * @throws {TRPCError} CONFLICT if events exist and `force` is false.
 * @throws {TRPCError} NOT_FOUND if the planning group or template does not exist.
 */
export async function applyTemplate(
  planningGroupId: string,
  templateId: string,
  anchorDate: Date,
  force: boolean,
  prisma: PrismaClient
) {
  return prisma.$transaction(async tx => {
    const group = await tx.planningGroup.findUnique({ where: { id: planningGroupId } });
    if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'Gruppo di pianificazione non trovato' });

    const existing = await tx.calendarEvent.count({ where: { planningGroupId } });
    if (existing > 0 && !force) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Il gruppo di pianificazione contiene già eventi. Usa force=true per sovrascrivere.',
      });
    }

    const template = await tx.milestoneTemplate.findUnique({
      where: { id: templateId },
      include: {
        items: {
          include: {
            visibilities: true,
            stateEffects: true,
          },
        },
      },
    });
    if (!template) throw new TRPCError({ code: 'NOT_FOUND', message: 'Template non trovato' });

    const itemsWithDates = template.items.map(item => {
      const startAt = new Date(anchorDate);
      startAt.setDate(startAt.getDate() + item.offsetDays);
      const endAt = item.durationDays > 0
        ? new Date(startAt.getTime() + item.durationDays * MS_PER_DAY)
        : undefined;
      return { item, startAt, endAt };
    });

    const created = await tx.calendarEvent.createManyAndReturn({
      data: itemsWithDates.map(({ item, startAt, endAt }) => ({
        calendarId: group.calendarId,
        planningGroupId,
        phaseId: item.phaseId,
        calendarDaysRelevance: item.calendarDaysRelevance,
        title: item.title,
        description: item.description,
        startAt,
        endAt,
        allDay: item.allDay,
        publishExternally: item.publishExternally,
        templateItemId: item.id,
      })),
    });

    const itemById = new Map(template.items.map(item => [item.id, item]));

    const visibilityData = created.flatMap(event => {
      const item = itemById.get(event.templateItemId!);
      if (!item) return [];
      return item.visibilities.map(v => ({
        eventId: event.id,
        functionId: v.functionId,
      }));
    });
    await tx.calendarEventVisibility.createMany({ data: visibilityData });

    // Materialize template state effects (only if targetEntityId can be inferred — skip otherwise)
    // V2: skip effects without targetEntityId (must be configured by user after apply)

    // Record the anchor date used, so a later re-apply/admin view can default to it.
    await tx.planningGroup.update({ where: { id: planningGroupId }, data: { anchorDate } });

    return created;
  });
}

// ─── Planning group CRUD ──────────────────────────────────────────────────────

/**
 * Creates a new (non-default) PlanningGroup within a SeasonCalendar.
 */
export async function createPlanningGroup(calendarId: string, name: string, prisma: PrismaClient) {
  return prisma.planningGroup.create({ data: { calendarId, name, isDefault: false } });
}

/**
 * Lists all PlanningGroups of a SeasonCalendar, default group first, then alphabetically,
 * with row/event counts (used to gate rename/delete in the admin UI).
 */
export async function listPlanningGroups(calendarId: string, prisma: PrismaClient) {
  return prisma.planningGroup.findMany({
    where: { calendarId },
    include: { _count: { select: { events: true, rows: true } } },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  });
}

/**
 * Renames a PlanningGroup. The default group cannot be renamed.
 *
 * @throws {TRPCError} NOT_FOUND if the group does not exist.
 * @throws {TRPCError} BAD_REQUEST if the group is the default one.
 */
export async function renamePlanningGroup(id: string, name: string, prisma: PrismaClient) {
  const group = await prisma.planningGroup.findUnique({ where: { id } });
  if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'Gruppo di pianificazione non trovato' });
  if (group.isDefault) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Il gruppo predefinito non può essere rinominato' });
  }
  return prisma.planningGroup.update({ where: { id }, data: { name } });
}

/**
 * Deletes a PlanningGroup. The default group cannot be deleted, and a group still owning events or
 * rows cannot be deleted either — reassign them to another group first.
 *
 * @throws {TRPCError} NOT_FOUND if the group does not exist.
 * @throws {TRPCError} BAD_REQUEST if the group is the default one.
 * @throws {TRPCError} CONFLICT if the group still owns events or rows.
 */
export async function deletePlanningGroup(id: string, prisma: PrismaClient) {
  const group = await prisma.planningGroup.findUnique({
    where: { id },
    include: { _count: { select: { events: true, rows: true } } },
  });
  if (!group) throw new TRPCError({ code: 'NOT_FOUND', message: 'Gruppo di pianificazione non trovato' });
  if (group.isDefault) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Il gruppo predefinito non può essere eliminato' });
  }
  if (group._count.events > 0 || group._count.rows > 0) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Il gruppo contiene ancora eventi o righe — riassegnale prima di eliminarlo',
    });
  }
  await prisma.planningGroup.delete({ where: { id } });
}

// ─── Template CRUD ────────────────────────────────────────────────────────────

/**
 * Creates a new milestone template with no items.
 */
export async function createTemplate(
  data: { name: string; description?: string },
  prisma: PrismaClient
) {
  return prisma.milestoneTemplate.create({ data, include: { items: true } });
}

/**
 * Updates the name or description of an existing milestone template.
 */
export async function updateTemplate(
  id: string,
  data: { name?: string; description?: string },
  prisma: PrismaClient
) {
  return prisma.milestoneTemplate.update({ where: { id }, data, include: { items: true } });
}

/**
 * Deletes a milestone template and all its items (cascade).
 */
export async function deleteTemplate(id: string, prisma: PrismaClient) {
  await prisma.milestoneTemplate.delete({ where: { id } });
}

/**
 * Adds an item to a milestone template with its visibility function assignments.
 */
export async function createTemplateItem(
  templateId: string,
  data: {
    title: string;
    phaseId?: string | null;
    calendarDaysRelevance?: CalendarDaysRelevance | null;
    visibilityFunctionIds: string[];
    offsetDays: number;
    durationDays: number;
    allDay: boolean;
    publishExternally: boolean;
    description?: string;
  },
  prisma: PrismaClient
) {
  const { visibilityFunctionIds, ...itemData } = data;
  return prisma.milestoneTemplateItem.create({
    data: {
      templateId,
      ...itemData,
      visibilities: {
        createMany: { data: visibilityFunctionIds.map(functionId => ({ functionId })) },
      },
    },
    include: { visibilities: true },
  });
}

/**
 * Partially updates a template item. When `visibilityFunctionIds` is provided,
 * existing visibility entries are replaced atomically within a transaction.
 */
export async function updateTemplateItem(
  id: string,
  data: {
    title?: string;
    phaseId?: string | null;
    calendarDaysRelevance?: CalendarDaysRelevance | null;
    visibilityFunctionIds?: string[];
    offsetDays?: number;
    durationDays?: number;
    allDay?: boolean;
    publishExternally?: boolean;
    description?: string;
  },
  prisma: PrismaClient
) {
  const { visibilityFunctionIds, ...itemData } = data;
  return prisma.$transaction(async tx => {
    const item = await tx.milestoneTemplateItem.update({ where: { id }, data: itemData });
    if (visibilityFunctionIds) {
      await tx.milestoneTemplateItemVisibility.deleteMany({ where: { templateItemId: id } });
      await tx.milestoneTemplateItemVisibility.createMany({
        data: visibilityFunctionIds.map(functionId => ({ templateItemId: id, functionId })),
      });
    }
    return tx.milestoneTemplateItem.findUniqueOrThrow({
      where: { id: item.id },
      include: { visibilities: true },
    });
  });
}

/**
 * Deletes a single template item (and its visibility entries via cascade).
 */
export async function deleteTemplateItem(id: string, prisma: PrismaClient) {
  await prisma.milestoneTemplateItem.delete({ where: { id } });
}

// ─── Clone ────────────────────────────────────────────────────────────────────

/**
 * Copies events from a chosen set of source planning groups into a target brand+season calendar.
 * For each selected source group, a matching target group is created (or reused, matched by name)
 * in the target calendar, and that group's events are cloned into it, shifted by `dateShiftDays`
 * (mandatory — there's no longer a single calendar-wide anchor date to auto-derive it from, since
 * anchorDate now lives per planning group).
 *
 * @throws {TRPCError} NOT_FOUND if the source calendar or any of the selected groups do not exist.
 */
export async function cloneFromBrandSeason(
  input: CloneSeasonCalendarInput,
  prisma: PrismaClient
) {
  const { sourceBrandId, sourceSeasonId, targetBrandId, targetSeasonId, sourcePlanningGroupIds, dateShiftDays, includeCancelled } = input;

  const sourceCalendar = await prisma.seasonCalendar.findUnique({
    where: { brandId_seasonId: { brandId: sourceBrandId, seasonId: sourceSeasonId } },
  });
  if (!sourceCalendar) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario sorgente non trovato' });
  }

  const sourceGroups = await prisma.planningGroup.findMany({
    where: { id: { in: sourcePlanningGroupIds }, calendarId: sourceCalendar.id },
    include: {
      events: {
        // Default clones only active events; cancelled ones are copied only when explicitly requested.
        where: includeCancelled ? {} : { cancelledAt: null },
        include: { visibilities: true },
      },
    },
  });
  if (sourceGroups.length !== sourcePlanningGroupIds.length) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Uno o più gruppi di pianificazione sorgente non trovati' });
  }

  const shift = dateShiftDays;

  return prisma.$transaction(async tx => {
    const targetCalendar = await tx.seasonCalendar.upsert({
      where: { brandId_seasonId: { brandId: targetBrandId, seasonId: targetSeasonId } },
      create: { brandId: targetBrandId, seasonId: targetSeasonId },
      update: {},
    });

    let totalCreated = 0;
    const createdEventIds: string[] = [];

    for (const sourceGroup of sourceGroups) {
      const targetGroup = await tx.planningGroup.upsert({
        where: { calendarId_name: { calendarId: targetCalendar.id, name: sourceGroup.name } },
        create: { calendarId: targetCalendar.id, name: sourceGroup.name, isDefault: sourceGroup.isDefault },
        update: {},
      });

      if (sourceGroup.events.length === 0) continue;

      const created = await tx.calendarEvent.createManyAndReturn({
        data: sourceGroup.events.map(e => ({
          calendarId: targetCalendar.id,
          planningGroupId: targetGroup.id,
          title: e.title,
          description: e.description,
          startAt: new Date(e.startAt.getTime() + shift * MS_PER_DAY),
          endAt: e.endAt ? new Date(e.endAt.getTime() + shift * MS_PER_DAY) : undefined,
          allDay: e.allDay,
          publishExternally: e.publishExternally,
        })),
      });

      const visibilityData = created.flatMap((newEvent, i) =>
        sourceGroup.events[i]!.visibilities.map(v => ({
          eventId: newEvent.id,
          functionId: v.functionId,
        }))
      );
      await tx.calendarEventVisibility.createMany({ data: visibilityData });

      totalCreated += created.length;
      createdEventIds.push(...created.map(e => e.id));
    }

    return {
      calendarId: targetCalendar.id,
      milestonesCreated: totalCreated,
      createdEventIds,
    };
  });
}

// ─── Sync status ──────────────────────────────────────────────────────────────

/**
 * Returns Google Calendar sync status for a SeasonCalendar,
 * aggregated by company function: event count and last sync timestamp.
 */
export async function getSyncStatus(calendarId: string, prisma: PrismaClient) {
  const mappings = await prisma.googleEventMapping.findMany({
    where: { event: { calendarId } },
    orderBy: { lastSyncedAt: 'desc' as const },
  });

  const byFunction = new Map<string, { count: number; lastSyncedAt: Date | null }>();
  for (const m of mappings) {
    const existing = byFunction.get(m.companyFunctionId) ?? { count: 0, lastSyncedAt: null };
    existing.count++;
    if (!existing.lastSyncedAt || m.lastSyncedAt > existing.lastSyncedAt) {
      existing.lastSyncedAt = m.lastSyncedAt;
    }
    byFunction.set(m.companyFunctionId, existing);
  }

  return {
    totalSynced: mappings.length,
    lastSyncedAt: mappings[0]?.lastSyncedAt ?? null,
    byFunction: Object.fromEntries(byFunction),
  };
}
