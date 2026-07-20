
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

// ─── Aggregation buffer for calendar notifications ─────────────────────────────

const CALENDAR_BUFFER_WINDOW_MS = 3 * 60 * 1000;

interface CalendarBufferEntry {
  actorName: string;
  calendarId: string | undefined;
  calendarLabel: string | null;
  /** Active admin ids at entry-creation time — cached so later calls in the same window don't re-query them. */
  adminIds: string[];
  userIds: Set<string>;
  count: number;
  firstCallAt: number;
  /** Raw `titleSuffix`/`message` from the first call, used verbatim only if the entry flushes with `count === 1`. */
  titleSuffix: string;
  rawMessage: string;
  singleLink: string;
}

const calendarBuffer = new Map<string, CalendarBufferEntry>();

function calendarBufferKey(actorId: string, calendarId: string | undefined): string {
  return `${actorId}::${calendarId ?? '_none'}`;
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
 * Does not send immediately: enqueues into a short in-memory buffer keyed by
 * (actorId, calendarId), flushed periodically by `flushDueCalendarNotifications`.
 * Multiple calls within the buffer window collapse into a single aggregated
 * notification instead of one per call — see that function for the flush logic.
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

  // Synchronous enqueue — no `await` between read and write, so concurrent calls
  // in the same event-loop tick cannot race on the same buffer entry.
  const key = calendarBufferKey(params.actorId, params.calendarId);
  const existing = calendarBuffer.get(key);

  // Actor and calendar are fixed by the buffer key, so a call joining an already-open
  // window can reuse the admin list cached on it instead of re-querying admin/actor/calendar.
  if (existing) {
    const allIds = [...new Set([...visibleUserIds, ...existing.adminIds])].filter(id => id !== params.actorId);
    if (allIds.length === 0) return;
    for (const id of allIds) existing.userIds.add(id);
    existing.count += 1;
    return;
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

  const adminIds = admins.map(a => a.id);
  const allIds = [...new Set([...visibleUserIds, ...adminIds])].filter(id => id !== params.actorId);
  if (allIds.length === 0) return;

  const actorName = actor ? fullName(actor) : params.actorId;
  const calendarLabel = calendar ? `${calendar.brand.name} · ${calendar.season.name}` : null;

  calendarBuffer.set(key, {
    actorName,
    calendarId: params.calendarId,
    calendarLabel,
    adminIds,
    userIds: new Set(allIds),
    count: 1,
    firstCallAt: Date.now(),
    titleSuffix: params.titleSuffix,
    rawMessage: params.message,
    singleLink: params.link ?? '/calendar',
  });
}

async function flushCalendarEntry(prisma: PrismaClient, entry: CalendarBufferEntry): Promise<void> {
  const userIds = [...entry.userIds];
  if (entry.count === 1) {
    const title = `${entry.actorName} ${entry.titleSuffix}`;
    const message = entry.calendarLabel ? `${entry.rawMessage} · ${entry.calendarLabel}` : entry.rawMessage;
    await bulkNotify(prisma, userIds, { category: 'CALENDAR', title, message, link: entry.singleLink });
    return;
  }

  const title = `${entry.actorName} ha modificato ${entry.count} eventi`;
  const message = entry.calendarLabel
    ? `${entry.count} modifiche al calendario · ${entry.calendarLabel}`
    : `${entry.count} modifiche al calendario`;

  await bulkNotify(prisma, userIds, {
    category: 'CALENDAR',
    title,
    message,
    link: '/calendar',
    data: { aggregated: true, count: entry.count, calendarId: entry.calendarId ?? null },
  });
}

type Logger = { error: (obj: unknown, msg?: string) => void };

async function drainCalendarEntries(prisma: PrismaClient, entries: CalendarBufferEntry[], log: Logger, context = ''): Promise<void> {
  for (const entry of entries) {
    try {
      await flushCalendarEntry(prisma, entry);
    } catch (err) {
      log.error({ err }, `Failed to flush aggregated calendar notification${context}`);
    }
  }
}

/**
 * Flushes all buffered calendar-notification entries whose buffer window has elapsed.
 * Each due entry is removed from the buffer *before* it is sent, so a new call for the
 * same (actorId, calendarId) pair arriving mid-flush starts a fresh entry/window instead
 * of being merged into one that is already being sent.
 */
export async function flushDueCalendarNotifications(prisma: PrismaClient, log: Logger): Promise<void> {
  const now = Date.now();
  const due: CalendarBufferEntry[] = [];
  for (const [key, entry] of calendarBuffer) {
    if (now - entry.firstCallAt >= CALENDAR_BUFFER_WINDOW_MS) {
      calendarBuffer.delete(key);
      due.push(entry);
    }
  }
  await drainCalendarEntries(prisma, due, log);
}

/**
 * Forces an immediate flush of the entire calendar-notification buffer, regardless of
 * window elapsed. Used on graceful shutdown (`onClose`) to avoid losing buffered
 * notifications that haven't reached their normal flush time yet.
 */
export async function flushAllCalendarNotifications(prisma: PrismaClient, log: Logger): Promise<void> {
  const entries = [...calendarBuffer.values()];
  calendarBuffer.clear();
  await drainCalendarEntries(prisma, entries, log, ' on shutdown');
}

// ─── Dedup helper for periodic scheduler notifications ────────────────────────

const dedupLastSentAt = new Map<string, number>();

export const SYSTEM_SUCCESS_DEDUP_MS = 24 * 60 * 60 * 1000;
export const SYSTEM_FAILURE_DEDUP_MS = 2 * 60 * 60 * 1000;

/**
 * Runs `send()` only if `windowMs` has elapsed since the last successful send for `key`.
 * The dedup timestamp is updated only after `send()` resolves without throwing, so a failed
 * send is retried on the next call instead of being silently suppressed for the full window.
 */
export async function notifyDeduped(key: string, windowMs: number, send: () => Promise<void>): Promise<void> {
  const last = dedupLastSentAt.get(key) ?? 0;
  if (Date.now() - last < windowMs) return;
  await send();
  dedupLastSentAt.set(key, Date.now());
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
