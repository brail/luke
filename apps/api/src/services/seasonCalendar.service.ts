import { TRPCError } from '@trpc/server';
import type { PrismaClient, CalendarMilestoneType } from '@prisma/client';
import type {
  CalendarMilestoneInput,
  CloneSeasonCalendarInput,
  PlanningSectionKey,
} from '@luke/core';

import { getUserAllowedBrandIds } from './context.service.js';

const MS_PER_DAY = 86_400_000;

// ─── Brand access helper ──────────────────────────────────────────────────────

export async function assertBrandAccess(
  userId: string,
  brandId: string,
  prisma: PrismaClient
): Promise<void> {
  const allowed = await getUserAllowedBrandIds(userId, prisma);
  if (allowed !== null && !allowed.includes(brandId)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Accesso al brand negato' });
  }
}

export async function filterAllowedBrandIds(
  userId: string,
  requestedBrandIds: string[],
  prisma: PrismaClient
): Promise<string[]> {
  const allowed = await getUserAllowedBrandIds(userId, prisma);
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
      _count: { select: { milestones: true } },
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

export async function listMilestones(
  seasonId: string,
  brandIds: string[],
  userId: string,
  sectionKey?: PlanningSectionKey
) {
  return { seasonId, brandIds, userId, sectionKey };
}

export async function listMilestonesDb(
  seasonId: string,
  brandIds: string[],
  userId: string,
  prisma: PrismaClient,
  sectionKey?: PlanningSectionKey
) {
  const calendars = await prisma.seasonCalendar.findMany({
    where: { seasonId, brandId: { in: brandIds } },
    select: { id: true, brandId: true },
  });
  const calendarIds = calendars.map(c => c.id);
  const calendarBrandMap = new Map(calendars.map(c => [c.id, c.brandId]));

  const milestones = await prisma.calendarMilestone.findMany({
    where: {
      calendarId: { in: calendarIds },
      ...(sectionKey
        ? { visibilities: { some: { sectionKey } } }
        : {}),
    },
    include: {
      visibilities: true,
      notes: { where: { userId }, take: 1 },
    },
    orderBy: { startAt: 'asc' },
  });

  return milestones.map(m => ({
    ...m,
    brandId: calendarBrandMap.get(m.calendarId) ?? null,
  }));
}

// ─── Milestone create/update/delete ──────────────────────────────────────────

export async function createMilestone(
  input: CalendarMilestoneInput,
  prisma: PrismaClient
) {
  return prisma.$transaction(async tx => {
    const milestone = await tx.calendarMilestone.create({
      data: {
        calendarId: input.calendarId,
        ownerSectionKey: input.ownerSectionKey,
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

    await tx.milestoneVisibility.createMany({
      data: input.visibleSectionKeys.map(sk => ({
        milestoneId: milestone.id,
        sectionKey: sk,
        readOnly: sk !== input.ownerSectionKey,
      })),
    });

    return milestone;
  });
}

export async function updateMilestone(
  milestoneId: string,
  input: Partial<CalendarMilestoneInput>,
  prisma: PrismaClient
) {
  return prisma.$transaction(async tx => {
    const updated = await tx.calendarMilestone.update({
      where: { id: milestoneId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.startAt !== undefined ? { startAt: new Date(input.startAt) } : {}),
        ...(input.endAt !== undefined ? { endAt: new Date(input.endAt) } : {}),
        ...(input.allDay !== undefined ? { allDay: input.allDay } : {}),
        ...(input.publishExternally !== undefined ? { publishExternally: input.publishExternally } : {}),
        ...(input.ownerSectionKey !== undefined ? { ownerSectionKey: input.ownerSectionKey } : {}),
      },
    });

    if (input.visibleSectionKeys) {
      await tx.milestoneVisibility.deleteMany({ where: { milestoneId } });
      const owner = input.ownerSectionKey ?? updated.ownerSectionKey;
      await tx.milestoneVisibility.createMany({
        data: input.visibleSectionKeys.map(sk => ({
          milestoneId,
          sectionKey: sk,
          readOnly: sk !== owner,
        })),
      });
    }

    return updated;
  });
}

export async function deleteMilestone(milestoneId: string, prisma: PrismaClient): Promise<void> {
  await prisma.calendarMilestone.delete({ where: { id: milestoneId } });
}

// ─── Note ────────────────────────────────────────────────────────────────────

export async function upsertNote(
  milestoneId: string,
  userId: string,
  body: string,
  prisma: PrismaClient
) {
  return prisma.milestonePersonalNote.upsert({
    where: { milestoneId_userId: { milestoneId, userId } },
    create: { milestoneId, userId, body },
    update: { body },
  });
}

export async function deleteNote(
  milestoneId: string,
  userId: string,
  prisma: PrismaClient
): Promise<void> {
  await prisma.milestonePersonalNote.deleteMany({ where: { milestoneId, userId } });
}

// ─── Template ─────────────────────────────────────────────────────────────────

export async function listTemplates(prisma: PrismaClient) {
  return prisma.milestoneTemplate.findMany({
    include: { items: { orderBy: { offsetDays: 'asc' } } },
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
    const existing = await tx.calendarMilestone.count({ where: { calendarId } });
    if (existing > 0 && !force) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Il calendario contiene già milestones. Usa force=true per sovrascrivere.',
      });
    }

    const template = await tx.milestoneTemplate.findUnique({
      where: { id: templateId },
      include: { items: true },
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

    const created = await tx.calendarMilestone.createManyAndReturn({
      data: itemsWithDates.map(({ item, startAt, endAt }) => ({
        calendarId,
        ownerSectionKey: item.ownerSectionKey,
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
    const visibilityData = created.flatMap(milestone => {
      const item = itemById.get(milestone.templateItemId!);
      if (!item) return [];
      return (item.visibleSectionKeys as string[]).map(sk => ({
        milestoneId: milestone.id,
        sectionKey: sk,
        readOnly: sk !== item.ownerSectionKey,
      }));
    });

    await tx.milestoneVisibility.createMany({ data: visibilityData });
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
    type: CalendarMilestoneType;
    ownerSectionKey: string;
    visibleSectionKeys: string[];
    offsetDays: number;
    durationDays: number;
    publishExternally: boolean;
    description?: string;
  },
  prisma: PrismaClient
) {
  return prisma.milestoneTemplateItem.create({
    data: { templateId, ...data },
  });
}

export async function updateTemplateItem(
  id: string,
  data: {
    title?: string;
    type?: CalendarMilestoneType;
    ownerSectionKey?: string;
    visibleSectionKeys?: string[];
    offsetDays?: number;
    durationDays?: number;
    publishExternally?: boolean;
    description?: string;
  },
  prisma: PrismaClient
) {
  return prisma.milestoneTemplateItem.update({ where: { id }, data });
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
      milestones: {
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

    const created = await tx.calendarMilestone.createManyAndReturn({
      data: sourceCalendar.milestones.map(m => ({
        calendarId: targetCalendar.id,
        ownerSectionKey: m.ownerSectionKey,
        type: m.type,
        title: m.title,
        description: m.description,
        startAt: new Date(m.startAt.getTime() + shift * MS_PER_DAY),
        endAt: m.endAt ? new Date(m.endAt.getTime() + shift * MS_PER_DAY) : undefined,
        allDay: m.allDay,
        publishExternally: m.publishExternally,
        status: 'PLANNED' as const,
      })),
    });

    const visibilityData = created.flatMap((newMilestone, i) => {
      return sourceCalendar.milestones[i].visibilities.map(v => ({
        milestoneId: newMilestone.id,
        sectionKey: v.sectionKey,
        readOnly: v.readOnly,
      }));
    });

    await tx.milestoneVisibility.createMany({ data: visibilityData });
    return { calendarId: targetCalendar.id, milestonesCreated: created.length };
  });
}

// ─── Sync status ──────────────────────────────────────────────────────────────

export async function getSyncStatus(calendarId: string, prisma: PrismaClient) {
  const mappings = await prisma.googleEventMapping.findMany({
    where: { milestone: { calendarId } },
    orderBy: { lastSyncedAt: 'desc' as const },
  });

  const bySection = new Map<string, { count: number; lastSyncedAt: Date | null }>();
  for (const m of mappings) {
    const existing = bySection.get(m.sectionKey) ?? { count: 0, lastSyncedAt: null };
    existing.count++;
    if (!existing.lastSyncedAt || m.lastSyncedAt > existing.lastSyncedAt) {
      existing.lastSyncedAt = m.lastSyncedAt;
    }
    bySection.set(m.sectionKey, existing);
  }

  return {
    totalSynced: mappings.length,
    lastSyncedAt: mappings[0]?.lastSyncedAt ?? null,
    bySection: Object.fromEntries(bySection),
  };
}
