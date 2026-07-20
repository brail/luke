
import { fullName } from '@luke/core';

import { sseStore } from './sseStore';

import type { PrismaClient, NotificationCategory, Prisma } from '@prisma/client';

/**
 * Parameters for creating a single in-app notification.
 */
interface CreateNotificationParams {
  userId: string;
  category: NotificationCategory;
  title: string;
  message: string;
  link?: string;
  data?: Record<string, unknown>;
}

/**
 * Creates a single in-app notification for a user if the user has not disabled
 * that notification category. Immediately pushes an SSE ping to connected clients.
 */
export async function createNotification(
  prisma: PrismaClient,
  params: CreateNotificationParams
): Promise<void> {
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId_category: { userId: params.userId, category: params.category } },
    select: { enabled: true },
  });

  if (pref?.enabled === false) return;

  await prisma.notification.create({
    data: {
      userId: params.userId,
      category: params.category,
      title: params.title,
      message: params.message,
      link: params.link ?? null,
      data: (params.data ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  sseStore.pushToUser(params.userId, { type: 'notification', payload: {} });
}

/**
 * Batch visibility lookup — resolves function-level and user-level visibility for multiple
 * calendar events in 3 queries total. Returns a map of eventId → userId[].
 */
export async function getVisibleUserIdsForMilestones(
  milestoneIds: string[],
  prisma: PrismaClient
): Promise<Map<string, string[]>> {
  if (milestoneIds.length === 0) return new Map();

  const [fnVisibilities, userVisibilities] = await Promise.all([
    prisma.calendarEventVisibility.findMany({
      where: { eventId: { in: milestoneIds } },
      select: { eventId: true, functionId: true },
    }),
    prisma.calendarEventUserVisibility.findMany({
      where: { eventId: { in: milestoneIds } },
      select: { eventId: true, userId: true },
    }),
  ]);

  const functionIds = [...new Set(fnVisibilities.map(v => v.functionId))];
  const teamMembers = functionIds.length > 0
    ? await prisma.companyTeamMembership.findMany({
        where: { team: { functionId: { in: functionIds }, isActive: true } },
        select: { userId: true, team: { select: { functionId: true } } },
      })
    : [];

  const fnToUsers = new Map<string, string[]>();
  for (const m of teamMembers) {
    if (!fnToUsers.has(m.team.functionId)) fnToUsers.set(m.team.functionId, []);
    fnToUsers.get(m.team.functionId)!.push(m.userId);
  }

  const result = new Map<string, Set<string>>(milestoneIds.map(id => [id, new Set()]));
  for (const v of fnVisibilities) {
    const set = result.get(v.eventId)!;
    for (const uid of fnToUsers.get(v.functionId) ?? []) set.add(uid);
  }
  for (const v of userVisibilities) result.get(v.eventId)?.add(v.userId);

  return new Map(Array.from(result, ([id, set]) => [id, Array.from(set)]));
}

/**
 * Returns the set of user IDs who should receive notifications for a milestone.
 * Includes members of all company teams whose function is linked to the event,
 * plus any users with a direct user-level visibility entry.
 */
export async function getVisibleUserIdsForMilestone(
  milestoneId: string,
  prisma: PrismaClient
): Promise<string[]> {
  return (await getVisibleUserIdsForMilestones([milestoneId], prisma)).get(milestoneId) ?? [];
}

/**
 * Shared core: filters disabled prefs, bulk-creates notifications, SSE-pings each recipient.
 */
async function bulkNotify(
  prisma: PrismaClient,
  userIds: string[],
  params: {
    category: NotificationCategory;
    title: string;
    message: string;
    link?: string | null;
    data?: Record<string, unknown>;
  }
): Promise<void> {
  if (userIds.length === 0) return;

  const disabledPrefs = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds }, category: params.category, enabled: false },
    select: { userId: true },
  });
  const disabledSet = new Set(disabledPrefs.map(p => p.userId));
  const toNotify = userIds.filter(id => !disabledSet.has(id));
  if (toNotify.length === 0) return;

  await prisma.notification.createMany({
    data: toNotify.map(userId => ({
      userId,
      category: params.category,
      title: params.title,
      message: params.message,
      link: params.link ?? null,
      data: (params.data ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });

  for (const userId of toNotify) {
    sseStore.pushToUser(userId, { type: 'notification', payload: {} });
  }
}

/**
 * Sends a CALENDAR-category notification about a calendar event change to all
 * users who have visibility on the event(s) plus all active admins, excluding the actor.
 *
 * - `eventId`: fetch visibility live for a single event (create/update/status change)
 * - `eventIds`: batch fetch visibility for multiple events (applyTemplate, clone)
 * - `preloadedUserIds`: use pre-fetched snapshot (delete, where event no longer exists)
 * - `calendarId`: optional — resolves brand·season label appended to the message
 *
 * Fire-and-forget: callers should call without `await` and `.catch(logger.error)`.
 */
export async function notifyCalendarChange(
  prisma: PrismaClient,
  params: {
    eventId?: string;
    eventIds?: string[];
    preloadedUserIds?: string[];
    actorId: string;
    titleSuffix: string;
    message: string;
    link?: string;
    calendarId?: string;
  }
): Promise<void> {
  let visibleUserIds: string[];
  if (params.preloadedUserIds) {
    visibleUserIds = params.preloadedUserIds;
  } else if (params.eventIds) {
    const map = await getVisibleUserIdsForMilestones(params.eventIds, prisma);
    visibleUserIds = [...new Set(params.eventIds.flatMap(id => map.get(id) ?? []))];
  } else if (params.eventId) {
    visibleUserIds = await getVisibleUserIdsForMilestone(params.eventId, prisma);
  } else {
    visibleUserIds = [];
  }

  const [admins, actor, calendar] = await Promise.all([
    prisma.user.findMany({ where: { role: 'admin', isActive: true }, select: { id: true } }),
    prisma.user.findUnique({
      where: { id: params.actorId },
      select: { firstName: true, lastName: true, username: true },
    }),
    params.calendarId
      ? prisma.seasonCalendar.findUnique({
          where: { id: params.calendarId },
          select: { brand: { select: { name: true } }, season: { select: { name: true } } },
        })
      : Promise.resolve(null),
  ]);

  const actorName = actor ? fullName(actor) : params.actorId;
  const title = `${actorName} ${params.titleSuffix}`;
  const calendarLabel = calendar ? `${calendar.brand.name} · ${calendar.season.name}` : null;
  const message = calendarLabel ? `${params.message} · ${calendarLabel}` : params.message;

  const allIds = [...new Set([...visibleUserIds, ...admins.map(a => a.id)])].filter(id => id !== params.actorId);
  await bulkNotify(prisma, allIds, { category: 'CALENDAR', title, message, link: params.link ?? '/calendar' });
}

/**
 * Broadcasts a notification to all active admin users in a single `createMany` call.
 * Respects per-user notification preferences (disabled entries are excluded).
 * Sends an SSE ping to each notified admin's active connections.
 */
export async function notifyAdmins(
  prisma: PrismaClient,
  params: Omit<CreateNotificationParams, 'userId'>
): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: 'admin', isActive: true },
    select: { id: true },
  });
  await bulkNotify(prisma, admins.map(a => a.id), params);
}
