import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';
import type {
  CalendarEventInput,
  CloneSeasonCalendarInput,
  Role,
} from '@luke/core';

import { getUserAllowedBrandIds } from './context.service.js';

const MS_PER_DAY = 86_400_000;

// ─── Brand access helper ──────────────────────────────────────────────────────

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

export async function updateCalendarStatus(
  calendarId: string,
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED',
  prisma: PrismaClient
) {
  return prisma.seasonCalendar.update({ where: { id: calendarId }, data: { status } });
}

export async function setAnchorDate(
  calendarId: string,
  anchorDate: Date,
  prisma: PrismaClient
) {
  return prisma.seasonCalendar.update({ where: { id: calendarId }, data: { anchorDate } });
}

// ─── Milestone list ───────────────────────────────────────────────────────────

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
    },
    orderBy: { startAt: 'asc' },
  });

  return events.map(e => ({
    ...e,
    brandId: calendarBrandMap.get(e.calendarId) ?? null,
  }));
}

// ─── Milestone create/update/delete ──────────────────────────────────────────

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

export async function deleteMilestone(eventId: string, prisma: PrismaClient): Promise<void> {
  await prisma.calendarEvent.delete({ where: { id: eventId } });
}

// ─── Note ────────────────────────────────────────────────────────────────────

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

export async function deleteNote(
  eventId: string,
  userId: string,
  prisma: PrismaClient
): Promise<void> {
  await prisma.calendarEventPersonalNote.deleteMany({ where: { eventId, userId } });
}

// ─── Template ─────────────────────────────────────────────────────────────────

export async function listTemplates(prisma: PrismaClient) {
  return prisma.milestoneTemplate.findMany({
    include: {
      items: {
        orderBy: { offsetDays: 'asc' },
        include: { visibilities: true },
      },
    },
    orderBy: { name: 'asc' },
  });
}

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
          include: { visibilities: true },
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
    return created;
  });
}

// ─── Template CRUD ────────────────────────────────────────────────────────────

export async function createTemplate(
  data: { name: string; description?: string },
  prisma: PrismaClient
) {
  return prisma.milestoneTemplate.create({ data, include: { items: true } });
}

export async function updateTemplate(
  id: string,
  data: { name?: string; description?: string },
  prisma: PrismaClient
) {
  return prisma.milestoneTemplate.update({ where: { id }, data, include: { items: true } });
}

export async function deleteTemplate(id: string, prisma: PrismaClient) {
  await prisma.milestoneTemplate.delete({ where: { id } });
}

export async function createTemplateItem(
  templateId: string,
  data: {
    title: string;
    type: string;
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

export async function updateTemplateItem(
  id: string,
  data: {
    title?: string;
    type?: string;
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

export async function deleteTemplateItem(id: string, prisma: PrismaClient) {
  await prisma.milestoneTemplateItem.delete({ where: { id } });
}

// ─── Clone ────────────────────────────────────────────────────────────────────

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
        include: { visibilities: true },
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
    return { calendarId: targetCalendar.id, milestonesCreated: created.length };
  });
}

// ─── Sync status ──────────────────────────────────────────────────────────────

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
