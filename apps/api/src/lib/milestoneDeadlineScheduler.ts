import {
  DEADLINE_REACH_MARGIN_MS,
  calendarDateIn,
  calendarDaysBetween,
  deadlineDay,
  deadlineReachedAt,
} from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { resolveEventAudience, resolveEventAudienceOne } from '../services/calendarAudience.service';
import { createRevisionsForReachedEvents } from '../services/collectionLayoutAutoRevision.service';
import { computeCriticalityForLayout, resolveAlertContext, type AlertContext } from '../services/phaseAlert.service';

import { guardMaintenance } from './maintenanceMode';
import { createNotification, notifyDeduped } from './notifications';
import { withSchedulerLock } from './schedulerLock';

import type { FastifyInstance } from 'fastify';

const TICK_INTERVAL_MS = 60 * 60 * 1000;

// At most one notification per user+entity+type per ~day. DB-backed via notifyDeduped (see
// notifications.ts) so the dedup ledger survives process restarts — kept just under 24h to
// avoid missing a day while minimizing drift across repeated sends.
const MILESTONE_DEDUP_MS = 23 * 60 * 60 * 1000;

type DeadlineType = 'upcoming' | 'overdue';

/** How far back a reached deadline is still notified as overdue. */
const OVERDUE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** "scade …" by calendar days to the deadline's day (0, 1, 2); further out is not notified yet. */
const UPCOMING_LABELS = ['oggi', 'domani', 'tra 2 giorni'];

async function notifyMilestone(
  prisma: PrismaClient,
  m: { id: string; title: string },
  type: DeadlineType,
  message: string,
): Promise<void> {
  const userIds = await resolveEventAudienceOne(m.id, prisma);
  await Promise.all(userIds.map(userId =>
    notifyDeduped(prisma, `milestone:${userId}:${m.id}:${type}`, MILESTONE_DEDUP_MS, () => createNotification(prisma, {
      userId,
      category: 'CALENDAR',
      title: type === 'upcoming' ? 'Milestone in scadenza' : 'Milestone scaduta',
      message,
      link: '/calendar',
      data: { milestoneId: m.id, type: `deadline_${type}` },
    }))
  ));
}

/**
 * Notifies once per row+event+day when a collection row's current phase has slipped past its
 * calendar deadline (`reached`, per `computeCriticalityForLayout` — same criticality engine as the
 * Controllo dashboards, no new calculation: an all-day deadline at the end of its day in the
 * business zone). Recipients are the event's visible users, same resolution as milestone deadline
 * notifications.
 *
 * Rows marked as concluded are skipped (`state === 'active'` guard): they carry a frozen outcome
 * instead of a countdown, and nagging about a deadline on work someone already closed is noise.
 */
async function checkRowPhaseOverdue(prisma: PrismaClient, now: Date, alert: AlertContext): Promise<void> {
  const layouts = await prisma.collectionLayout.findMany({ select: { id: true } });

  const overdueRows = (
    await Promise.all(
      layouts.map(layout => computeCriticalityForLayout(layout.id, now, prisma, alert))
    )
  )
    .flat()
    // Type predicate, not a plain boolean: the criticality result is a union and only the 'active'
    // arm carries `eventId`/`eventTitle`, which the notification below needs.
    .filter((r): r is Extract<typeof r, { state: 'active' }> => r.state === 'active' && r.reached);
  if (overdueRows.length === 0) return;

  const rowIds = overdueRows.map(r => r.rowId);
  const uniqueEventIds = [...new Set(overdueRows.map(r => r.eventId))];
  const [rows, visibilityMap] = await Promise.all([
    prisma.collectionLayoutRow.findMany({
      where: { id: { in: rowIds } },
      select: { id: true, line: true },
    }),
    resolveEventAudience(uniqueEventIds, prisma),
  ]);
  const lineByRowId = new Map(rows.map(r => [r.id, r.line]));

  await Promise.all(
    overdueRows.map(async r => {
      const userIds = visibilityMap.get(r.eventId) ?? [];
      const line = lineByRowId.get(r.rowId) ?? r.rowId;
      await Promise.all(userIds.map(userId =>
        notifyDeduped(prisma, `milestone:${userId}:${r.rowId}:phase_overdue`, MILESTONE_DEDUP_MS, () => createNotification(prisma, {
          userId,
          category: 'CALENDAR',
          title: 'Fase scaduta',
          message: `"${line}" non ha completato "${r.eventTitle}" entro la scadenza`,
          // Deep-links to the specific row (page.tsx opens its edit drawer on load) instead of
          // dropping the user on the generic layout page to search for it manually. Only works
          // if the user's currently-selected brand/season already matches the row's — the page
          // doesn't switch context from the link, since that's driven by a separate, server-side
          // user preference (no URL-param override exists for it today).
          link: `/product/collection-layout?rowId=${encodeURIComponent(r.rowId)}`,
          data: { rowId: r.rowId, eventId: r.eventId, type: 'phase_overdue' },
        }))
      ));
    })
  );
}

/**
 * What to notify about one event's deadline at `now`, or nothing — the whole rule of
 * `checkDeadlines`. Measured on the deadline (`endAt ?? startAt`) the way every other consumer
 * measures it: "in scadenza" while it is not reached and its day is at most two calendar days away
 * in the business zone, "scaduta" for three days after it is reached. Pure.
 */
export function milestoneNotice(
  m: { title: string; startAt: Date; endAt: Date | null; allDay: boolean },
  now: Date,
  timeZone: string,
): { type: DeadlineType; message: string } | null {
  const reachedAt = deadlineReachedAt(m, timeZone);
  if (reachedAt <= now) {
    return reachedAt.getTime() >= now.getTime() - OVERDUE_WINDOW_MS
      ? { type: 'overdue', message: `"${m.title}" è scaduta senza essere completata` }
      : null;
  }
  const label = UPCOMING_LABELS[calendarDaysBetween(calendarDateIn(now, timeZone), deadlineDay(m, timeZone))];
  return label ? { type: 'upcoming', message: `"${m.title}" scade ${label}` } : null;
}

async function checkDeadlines(prisma: PrismaClient, logger: FastifyInstance['log']): Promise<void> {
  const now = new Date();
  const alert = await resolveAlertContext(prisma);
  const { timeZone } = alert;

  // A superset of stored deadlines: reached no earlier than the overdue window (minus the reach
  // margin), and on a day no later than today + 2 — within three days of now, plus a day of slack
  // for a DST change in between. Exact rules below.
  const storedFrom = new Date(now.getTime() - OVERDUE_WINDOW_MS - DEADLINE_REACH_MARGIN_MS);
  const storedTo = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000);
  const events = await prisma.calendarEvent.findMany({
    where: {
      cancelledAt: null,
      OR: [
        { endAt: { gte: storedFrom, lte: storedTo } },
        { endAt: null, startAt: { gte: storedFrom, lte: storedTo } },
      ],
    },
    select: { id: true, title: true, startAt: true, endAt: true, allDay: true },
  });

  const notifications = events.flatMap(m => {
    const notice = milestoneNotice(m, now, timeZone);
    return notice ? [notifyMilestone(prisma, m, notice.type, notice.message)] : [];
  });

  await Promise.all([
    ...notifications,
    checkRowPhaseOverdue(prisma, now, alert),
    // Auto-revision of the collection layout for every phase-linked event whose deadline was reached.
    createRevisionsForReachedEvents(prisma, now, timeZone, logger),
  ]);
}

/**
 * Registers the milestone deadline notification scheduler as a Fastify plugin.
 * Checks for upcoming (due within two calendar days) and overdue (reached within 3 days) calendar
 * events on an hourly tick and creates per-user notifications with per-day deduplication.
 * The first check runs 60 seconds after server ready to avoid boot-time noise.
 */
export function registerMilestoneDeadlineScheduler(
  fastify: FastifyInstance,
  prisma: PrismaClient,
): void {
  let timer: ReturnType<typeof setInterval> | null = null;

  const guardedCheck = guardMaintenance(prisma, withSchedulerLock(prisma, 'milestone-deadline', () => checkDeadlines(prisma, fastify.log)));
  const run = () =>
    guardedCheck().catch(err =>
      fastify.log.error({ err }, 'Milestone deadline check failed')
    );

  fastify.addHook('onReady', async () => {
    fastify.log.info('Milestone deadline scheduler: started (hourly tick)');
    setTimeout(() => void run(), 60_000);
    timer = setInterval(() => void run(), TICK_INTERVAL_MS);
  });

  fastify.addHook('onClose', async () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    fastify.log.info('Milestone deadline scheduler: stopped');
  });
}
