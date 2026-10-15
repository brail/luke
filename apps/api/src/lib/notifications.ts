
import { CATEGORY_LEVEL_EVENT_KEY, fullName, type CalendarChangeKey, type CalendarEventKey } from '@luke/core';
import type { PrismaClient, NotificationCategory, Prisma } from '@luke/db';

import { resolveEventAudience, resolveEventAudienceOne } from '../services/calendarAudience.service';

import { sseStore } from './sseStore';


/** A notification as every sender stores it. */
interface NotificationRow {
  userId: string;
  category: NotificationCategory;
  title: string;
  message: string;
  link?: string | null;
  data?: Record<string, unknown>;
}

/** Parameters for creating a single in-app notification. */
interface CreateNotificationParams extends NotificationRow {
  /** Optional fine-grained CALENDAR event key — see `receives`. */
  eventKey?: CalendarEventKey;
}

/** Stored preferences, by user then event key (`CATEGORY_LEVEL_EVENT_KEY` for the category row). */
export type Preferences = Map<string, Map<string, boolean>>;

export async function preferencesOf(
  prisma: PrismaClient,
  userIds: string[],
  category: NotificationCategory,
  eventKeys: string[],
): Promise<Preferences> {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds }, category, eventKey: { in: [...new Set([...eventKeys, CATEGORY_LEVEL_EVENT_KEY])] } },
    select: { userId: true, eventKey: true, enabled: true },
  });
  const byUser: Preferences = new Map();
  for (const r of rows) byUser.set(r.userId, (byUser.get(r.userId) ?? new Map()).set(r.eventKey, r.enabled));
  return byUser;
}

/**
 * The one rule every sender applies — a single notification, a grouped notice, the digest: the
 * category is the master switch, and a key the user switched off mutes that kind too. Nothing stored
 * means on. `CATEGORY_LEVEL_EVENT_KEY` asks for the category alone.
 */
export function receives(prefs: Preferences, userId: string, eventKey: string): boolean {
  const mine = prefs.get(userId);
  return mine?.get(CATEGORY_LEVEL_EVENT_KEY) !== false && mine?.get(eventKey) !== false;
}

/** Those of `userIds` who receive `category` notifications of `eventKey` (`receives`). */
export async function recipientsOf(
  prisma: PrismaClient,
  userIds: string[],
  category: NotificationCategory,
  eventKey?: CalendarEventKey,
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const key = eventKey ?? CATEGORY_LEVEL_EVENT_KEY;
  const prefs = await preferencesOf(prisma, userIds, category, [key]);
  return userIds.filter(id => receives(prefs, id, key));
}

/**
 * Creates a single in-app notification for a user who receives it (`recipientsOf`), and pushes an
 * SSE ping to their connected clients.
 */
export async function createNotification(
  prisma: PrismaClient,
  params: CreateNotificationParams
): Promise<void> {
  if ((await recipientsOf(prisma, [params.userId], params.category, params.eventKey)).length === 0) return;
  await insertNotifications(prisma, [params]);
}

/**
 * Shared core: filters disabled prefs, bulk-creates notifications, SSE-pings each recipient.
 * Exported (not just used internally by `notifyAdmins`/`notifyAllUsers`) so a caller that
 * already has the recipient id list on hand — e.g. because it also needs it for something
 * else in the same request — can call this directly instead of forcing another `user.findMany`
 * through `notifyAllUsers`'s own internal query.
 */
export async function bulkNotify(
  prisma: PrismaClient,
  userIds: string[],
  params: Omit<NotificationRow, 'userId'>
): Promise<void> {
  const toNotify = await recipientsOf(prisma, userIds, params.category);
  await insertNotifications(prisma, toNotify.map(userId => ({ userId, ...params })));
}

/** Inserts `rows` in one statement and pings each recipient's connected clients over SSE. */
async function insertNotifications(prisma: PrismaClient, rows: NotificationRow[]): Promise<void> {
  if (rows.length === 0) return;
  await prisma.notification.createMany({
    data: rows.map(r => ({
      userId: r.userId,
      category: r.category,
      title: r.title,
      message: r.message,
      link: r.link ?? null,
      // `data` is built by the senders from JSON-safe values; Prisma types the column as InputJsonValue.
      data: (r.data ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });
  for (const { userId } of rows) sseStore.pushToUser(userId, { type: 'notification', payload: {} });
}

// ─── Aggregation buffer for calendar notifications ─────────────────────────────

const CALENDAR_BUFFER_WINDOW_MS = 3 * 60 * 1000;

/** One `notifyCalendarChange` call held in a buffer entry. */
interface BufferedChange {
  titleSuffix: string;
  message: string;
  link: string;
  /** `CATEGORY_LEVEL_EVENT_KEY` for a call without a key: only the category applies to it. */
  eventKey: string;
}

interface CalendarBufferEntry {
  actorName: string;
  calendarId: string | undefined;
  calendarLabel: string | null;
  /**
   * Per recipient, the calls they were in the audience of. At flush a recipient hears of those they
   * have not muted (`receives`): one by its own title, message and link, several by their count.
   */
  heardBy: Map<string, BufferedChange[]>;
  firstCallAt: number;
}

const calendarBuffer = new Map<string, CalendarBufferEntry>();

function calendarBufferKey(actorId: string, calendarId: string | undefined): string {
  return `${actorId}::${calendarId ?? '_none'}`;
}

/** Records one call in `entry`, once for each of `userIds`. */
function addChange(entry: CalendarBufferEntry, userIds: string[], change: BufferedChange): void {
  for (const id of new Set(userIds)) {
    const heard = entry.heardBy.get(id);
    if (heard) heard.push(change);
    else entry.heardBy.set(id, [change]);
  }
}

/**
 * Sends a CALENDAR-category notification about a calendar event change to all users who can see
 * the event(s) (`resolveEventAudience` — brand-scoped, per-function or per-user grant), excluding
 * the actor.
 *
 * - `eventId`: fetch visibility live for a single event (create/update/status change)
 * - `eventIds`: batch fetch visibility for multiple events (applyTemplate, clone)
 * - `preloadedUserIds`: use pre-fetched snapshot (delete, where event no longer exists) — the
 *   caller is responsible for having already brand-filtered it (see `calendarDigestScheduler`'s
 *   delete branch for the pattern)
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
    /** The change's CALENDAR event key — see `CalendarBufferEntry.heardBy`. */
    eventKey?: CalendarChangeKey;
  }
): Promise<void> {
  let visibleUserIds: string[];
  if (params.preloadedUserIds) {
    visibleUserIds = params.preloadedUserIds;
  } else if (params.eventIds) {
    const map = await resolveEventAudience(params.eventIds, prisma);
    visibleUserIds = [...new Set(params.eventIds.flatMap(id => map.get(id) ?? []))];
  } else if (params.eventId) {
    visibleUserIds = await resolveEventAudienceOne(params.eventId, prisma);
  } else {
    visibleUserIds = [];
  }

  const allIds = visibleUserIds.filter(id => id !== params.actorId);
  if (allIds.length === 0) return;

  const change: BufferedChange = {
    titleSuffix: params.titleSuffix,
    message: params.message,
    link: params.link ?? '/calendar',
    eventKey: params.eventKey ?? CATEGORY_LEVEL_EVENT_KEY,
  };
  const key = calendarBufferKey(params.actorId, params.calendarId);
  const existing = calendarBuffer.get(key);
  if (existing) {
    addChange(existing, allIds, change);
    return;
  }

  const [actor, calendar] = await Promise.all([
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

  // Another call for the same (actor, calendar) may have opened the entry while this one awaited:
  // join it rather than replace it.
  const opened = calendarBuffer.get(key);
  if (opened) {
    addChange(opened, allIds, change);
    return;
  }
  const entry: CalendarBufferEntry = {
    actorName: actor ? fullName(actor) : params.actorId,
    calendarId: params.calendarId,
    calendarLabel: calendar ? `${calendar.brand.name} · ${calendar.season.name}` : null,
    heardBy: new Map(),
    firstCallAt: Date.now(),
  };
  addChange(entry, allIds, change);
  calendarBuffer.set(key, entry);
}

/**
 * Sends `entry`: each recipient is told of the changes they have not muted (`receives`) — one by its
 * own title, message and link, several by their count — and of nothing if they muted them all.
 */
async function flushCalendarEntry(prisma: PrismaClient, entry: CalendarBufferEntry): Promise<void> {
  const userIds = [...entry.heardBy.keys()];
  const prefs = await preferencesOf(prisma, userIds, 'CALENDAR', [...new Set([...entry.heardBy.values()].flat().map(c => c.eventKey))]);
  const label = entry.calendarLabel ? ` · ${entry.calendarLabel}` : '';

  await insertNotifications(prisma, userIds.flatMap((userId): NotificationRow[] => {
    const heard = (entry.heardBy.get(userId) ?? []).filter(c => receives(prefs, userId, c.eventKey));
    const [only] = heard;
    if (!only) return [];
    if (heard.length === 1) {
      return [{ userId, category: 'CALENDAR', title: `${entry.actorName} ${only.titleSuffix}`, message: `${only.message}${label}`, link: only.link }];
    }
    return [{
      userId,
      category: 'CALENDAR',
      title: `${entry.actorName} ha modificato ${heard.length} eventi`,
      message: `${heard.length} modifiche al calendario${label}`,
      link: '/calendar',
      data: { aggregated: true, count: heard.length, calendarId: entry.calendarId ?? null },
    }];
  }));
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

export const SYSTEM_FAILURE_DEDUP_MS = 6 * 60 * 60 * 1000;

/**
 * Runs `send()` only if `windowMs` has elapsed since the last successful send for `key`.
 * The dedup ledger is persisted in `NotificationDedupKey` (not in-memory) so it survives
 * process restarts — otherwise every redeploy/restart would reset the window and re-fire
 * recurring notifications (e.g. sync failures, overdue milestones) regardless of how
 * recently one was already sent. The timestamp is updated only after `send()` resolves
 * without throwing, so a failed send is retried on the next call instead of being silently
 * suppressed for the full window.
 */
export async function notifyDeduped(
  prisma: PrismaClient,
  key: string,
  windowMs: number,
  send: () => Promise<void>
): Promise<void> {
  const existing = await prisma.notificationDedupKey.findUnique({ where: { key } });
  if (existing && Date.now() - existing.lastSentAt.getTime() < windowMs) return;
  await send();
  await prisma.notificationDedupKey.upsert({
    where: { key },
    create: { key, lastSentAt: new Date() },
    update: { lastSentAt: new Date() },
  });
}

/**
 * Broadcasts a notification to all active admin users in a single `createMany` call.
 * Respects per-user notification preferences (disabled entries are excluded).
 * Sends an SSE ping to each notified admin's active connections.
 */
export async function notifyAdmins(
  prisma: PrismaClient,
  params: Omit<NotificationRow, 'userId'>
): Promise<void> {
  const admins = await prisma.user.findMany({
    where: { role: 'admin', isActive: true },
    select: { id: true },
  });
  await bulkNotify(prisma, admins.map(a => a.id), params);
}

/**
 * Broadcasts a notification to every active user (all roles) in a single `createMany` call.
 * Respects per-user notification preferences (disabled entries are excluded).
 * Sends an SSE ping to each notified user's active connections.
 */
export async function notifyAllUsers(
  prisma: PrismaClient,
  params: Omit<NotificationRow, 'userId'>
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  await bulkNotify(prisma, users.map(u => u.id), params);
}
