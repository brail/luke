import { TRPCError } from '@trpc/server';

import type {
  CalendarEventInput,
  CloneSeasonCalendarInput,
  Role,
} from '@luke/core';

import { getUserAllowedBrandIds } from './context.service.js';

import type { PrismaClient } from '@prisma/client';

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
 * Returns the SeasonCalendar for the given brand+season, creating it if it does not exist.
 * Includes brand/season metadata and event count.
 */
export async function getOrCreateCalendar(
  brandId: string,
  seasonId: string,
  prisma: PrismaClient
) {
  return prisma.seasonCalendar.upsert({
    where: { brandId_seasonId: { brandId, seasonId } },
    create: { brandId, seasonId },
    update: {},
    include: {
      brand: { select: { code: true, name: true } },
      season: { select: { code: true, name: true, year: true } },
      _count: { select: { events: true } },
    },
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
 * Sets the anchor date on a SeasonCalendar, used as the reference point for template offset calculations.
 */
export async function setAnchorDate(
  calendarId: string,
  anchorDate: Date,
  prisma: PrismaClient
) {
  return prisma.seasonCalendar.update({ where: { id: calendarId }, data: { anchorDate } });
}

/**
 * Freezes a SeasonCalendar's baseline: snapshots the current startAt/endAt of every event into
 * baselineStartAt/baselineEndAt (written once, never updated afterwards), then sets frozenAt.
 * startAt/endAt remain freely editable after freeze — only the baseline snapshot is immutable.
 *
 * @throws {TRPCError} NOT_FOUND if the calendar does not exist.
 * @throws {TRPCError} CONFLICT if the calendar was already frozen (re-freeze is not supported —
 *   the baseline must reflect the plan "as it was" at first freeze, never a later re-snapshot).
 */
export async function freezeCalendar(calendarId: string, prisma: PrismaClient) {
  return prisma.$transaction(async tx => {
    const calendar = await tx.seasonCalendar.findUnique({ where: { id: calendarId } });
    if (!calendar) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario non trovato' });
    }
    if (calendar.frozenAt) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Calendario già congelato' });
    }

    const events = await tx.calendarEvent.findMany({
      where: { calendarId },
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

    return tx.seasonCalendar.update({
      where: { id: calendarId },
      data: { frozenAt: new Date() },
    });
  });
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
      anchors: { select: { entityType: true, entityId: true } },
    },
    orderBy: { startAt: 'asc' },
  });

  return events.map(e => ({
    ...e,
    brandId: calendarBrandMap.get(e.calendarId) ?? null,
  }));
}

// ─── Milestone create/update/delete ──────────────────────────────────────────

/**
 * Creates a calendar event and its visibility entries within a single transaction.
 * The owner function always receives a read-write visibility; all others are read-only.
 */
export async function createMilestone(
  input: CalendarEventInput,
  prisma: PrismaClient
) {
  return prisma.$transaction(async tx => {
    const event = await tx.calendarEvent.create({
      data: {
        calendarId: input.calendarId,
        ownerFunctionId: input.ownerFunctionId,
        type: input.type,
        phaseId: input.phaseId,
        title: input.title,
        description: input.description,
        startAt: new Date(input.startAt),
        endAt: input.endAt ? new Date(input.endAt) : undefined,
        allDay: input.allDay,
        publishExternally: input.publishExternally,
        templateItemId: input.templateItemId,
        status: input.status,
      },
    });

    await tx.calendarEventVisibility.createMany({
      data: input.visibilityFunctionIds.map(fId => ({
        eventId: event.id,
        functionId: fId,
        readOnly: fId !== input.ownerFunctionId,
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
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.phaseId !== undefined ? { phaseId: input.phaseId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.startAt !== undefined ? { startAt: new Date(input.startAt) } : {}),
        ...(input.endAt !== undefined ? { endAt: new Date(input.endAt) } : {}),
        ...(input.allDay !== undefined ? { allDay: input.allDay } : {}),
        ...(input.publishExternally !== undefined ? { publishExternally: input.publishExternally } : {}),
        ...(input.ownerFunctionId !== undefined ? { ownerFunctionId: input.ownerFunctionId } : {}),
      },
    });

    if (input.visibilityFunctionIds) {
      await tx.calendarEventVisibility.deleteMany({ where: { eventId } });
      const owner = input.ownerFunctionId ?? updated.ownerFunctionId;
      await tx.calendarEventVisibility.createMany({
        data: input.visibilityFunctionIds.map(fId => ({
          eventId,
          functionId: fId,
          readOnly: fId !== owner,
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
 * Materializes a milestone template onto a calendar anchored at `anchorDate`.
 * Creates events and visibility entries within a transaction.
 *
 * @param force - When false, throws CONFLICT if the calendar already has events.
 * @throws {TRPCError} CONFLICT if events exist and `force` is false.
 * @throws {TRPCError} NOT_FOUND if the template does not exist.
 */
export async function applyTemplate(
  calendarId: string,
  templateId: string,
  anchorDate: Date,
  force: boolean,
  prisma: PrismaClient
) {
  return prisma.$transaction(async tx => {
    const existing = await tx.calendarEvent.count({ where: { calendarId } });
    if (existing > 0 && !force) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Il calendario contiene già eventi. Usa force=true per sovrascrivere.',
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
        calendarId,
        ownerFunctionId: item.ownerFunctionId,
        type: item.type,
        phaseId: item.phaseId,
        title: item.title,
        description: item.description,
        startAt,
        endAt,
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
        readOnly: v.functionId !== item.ownerFunctionId,
      }));
    });
    await tx.calendarEventVisibility.createMany({ data: visibilityData });

    // Materialize template state effects (only if targetEntityId can be inferred — skip otherwise)
    // V2: skip effects without targetEntityId (must be configured by user after apply)

    return created;
  });
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
    type: string;
    phaseId?: string | null;
    ownerFunctionId: string;
    visibilityFunctionIds: string[];
    offsetDays: number;
    durationDays: number;
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
    type?: string;
    phaseId?: string | null;
    ownerFunctionId?: string;
    visibilityFunctionIds?: string[];
    offsetDays?: number;
    durationDays?: number;
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
 * Copies all matching events from a source brand+season calendar into a target brand+season calendar.
 * Event dates are shifted by `dateShiftDays`; when omitted, the shift is computed from the
 * difference between the two calendars' anchor dates.
 *
 * @throws {TRPCError} NOT_FOUND if the source calendar does not exist.
 * @throws {TRPCError} BAD_REQUEST if `dateShiftDays` is omitted and either calendar lacks an anchor date.
 */
export async function cloneFromBrandSeason(
  input: CloneSeasonCalendarInput,
  prisma: PrismaClient
) {
  const { sourceBrandId, sourceSeasonId, targetBrandId, targetSeasonId, dateShiftDays, includeStatuses } = input;

  const sourceCalendar = await prisma.seasonCalendar.findUnique({
    where: { brandId_seasonId: { brandId: sourceBrandId, seasonId: sourceSeasonId } },
    include: {
      events: {
        where: { status: { in: includeStatuses as ('PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED')[] } },
        include: {
          visibilities: true,
        },
      },
    },
  });
  if (!sourceCalendar) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Calendario sorgente non trovato' });
  }

  let shiftDays = dateShiftDays;
  if (shiftDays === undefined) {
    const targetCalendarExisting = await prisma.seasonCalendar.findUnique({
      where: { brandId_seasonId: { brandId: targetBrandId, seasonId: targetSeasonId } },
      select: { anchorDate: true },
    });
    if (!sourceCalendar.anchorDate || !targetCalendarExisting?.anchorDate) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'dateShiftDays è richiesto quando i calendari non hanno anchorDate impostata',
      });
    }
    const srcAnchor = sourceCalendar.anchorDate.getTime();
    const tgtAnchor = targetCalendarExisting.anchorDate.getTime();
    shiftDays = Math.round((tgtAnchor - srcAnchor) / MS_PER_DAY);
  }

  const shift = shiftDays;

  return prisma.$transaction(async tx => {
    const targetCalendar = await tx.seasonCalendar.upsert({
      where: { brandId_seasonId: { brandId: targetBrandId, seasonId: targetSeasonId } },
      create: { brandId: targetBrandId, seasonId: targetSeasonId },
      update: {},
    });

    const created = await tx.calendarEvent.createManyAndReturn({
      data: sourceCalendar.events.map(e => ({
        calendarId: targetCalendar.id,
        ownerFunctionId: e.ownerFunctionId,
        type: e.type,
        title: e.title,
        description: e.description,
        startAt: new Date(e.startAt.getTime() + shift * MS_PER_DAY),
        endAt: e.endAt ? new Date(e.endAt.getTime() + shift * MS_PER_DAY) : undefined,
        allDay: e.allDay,
        publishExternally: e.publishExternally,
        status: 'PLANNED' as const,
      })),
    });

    const visibilityData = created.flatMap((newEvent, i) => {
      return sourceCalendar.events[i].visibilities.map(v => ({
        eventId: newEvent.id,
        functionId: v.functionId,
        readOnly: v.readOnly,
      }));
    });
    await tx.calendarEventVisibility.createMany({ data: visibilityData });

    return {
      calendarId: targetCalendar.id,
      milestonesCreated: created.length,
      createdEventIds: created.map(e => e.id),
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
