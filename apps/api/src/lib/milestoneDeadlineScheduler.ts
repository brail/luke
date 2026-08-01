import { createRevisionsForReachedEvents } from '../services/collectionLayoutAutoRevision.service';
import { computeCriticalityForLayout, resolveAlertThresholds } from '../services/phaseAlert.service';

import { guardMaintenance } from './maintenanceMode';
import { createNotification, getVisibleUserIdsForMilestone, getVisibleUserIdsForMilestones, notifyDeduped } from './notifications';
import { withSchedulerLock } from './schedulerLock';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

const TICK_INTERVAL_MS = 60 * 60 * 1000;

// At most one notification per user+entity+type per ~day. DB-backed via notifyDeduped (see
// notifications.ts) so the dedup ledger survives process restarts — kept just under 24h to
// avoid missing a day while minimizing drift across repeated sends.
const MILESTONE_DEDUP_MS = 23 * 60 * 60 * 1000;

type DeadlineType = 'upcoming' | 'overdue';

async function notifyMilestone(
  prisma: PrismaClient,
  m: { id: string; title: string },
  type: DeadlineType,
  message: string,
): Promise<void> {
  const userIds = await getVisibleUserIdsForMilestone(m.id, prisma);
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
 * calendar deadline (`daysToDeadline < 0`, per `computeCriticalityForLayout` — same criticality
 * engine as the Controllo dashboards, no new calculation). Recipients are the event's visible
 * users, same resolution as milestone deadline notifications.
 */
async function checkRowPhaseOverdue(prisma: PrismaClient): Promise<void> {
  const layouts = await prisma.collectionLayout.findMany({ select: { id: true } });
  const thresholds = await resolveAlertThresholds(prisma);

  const overdueRows = (
    await Promise.all(
      layouts.map(layout => computeCriticalityForLayout(layout.id, new Date(), prisma, thresholds))
    )
  )
    .flat()
    .filter(r => r.daysToDeadline < 0);
  if (overdueRows.length === 0) return;

  const rowIds = overdueRows.map(r => r.rowId);
  const uniqueEventIds = [...new Set(overdueRows.map(r => r.eventId))];
  const [rows, visibilityMap] = await Promise.all([
    prisma.collectionLayoutRow.findMany({
      where: { id: { in: rowIds } },
      select: { id: true, line: true },
    }),
    getVisibleUserIdsForMilestones(uniqueEventIds, prisma),
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

async function checkDeadlines(prisma: PrismaClient, logger: FastifyInstance['log']): Promise<void> {
  const now = new Date();

  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  const [upcoming, overdue] = await Promise.all([
    prisma.calendarEvent.findMany({
      where: { startAt: { gte: now, lte: in48h }, cancelledAt: null },
      select: { id: true, title: true, startAt: true },
    }),
    prisma.calendarEvent.findMany({
      where: { startAt: { gte: threeDaysAgo, lt: now }, cancelledAt: null },
      select: { id: true, title: true, startAt: true },
    }),
  ]);

  await Promise.all([
    ...upcoming.map(m => {
      const hoursLeft = Math.round((m.startAt.getTime() - now.getTime()) / 3_600_000);
      return notifyMilestone(prisma, m, 'upcoming', `"${m.title}" scade ${hoursLeft <= 24 ? 'domani' : 'tra 2 giorni'}`);
    }),
    ...overdue.map(m =>
      notifyMilestone(prisma, m, 'overdue', `"${m.title}" è scaduta senza essere completata`)
    ),
    checkRowPhaseOverdue(prisma),
    // Auto-revision of the collection layout for every phase-linked event whose deadline just passed.
    createRevisionsForReachedEvents(prisma, now, logger),
  ]);
}

/**
 * Registers the milestone deadline notification scheduler as a Fastify plugin.
 * Checks for upcoming (within 48 h) and overdue (within 3 days) calendar events
 * on an hourly tick and creates per-user notifications with per-day deduplication.
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
    fastify.log.info('Milestone deadline scheduler: avviato (tick ogni ora)');
    setTimeout(() => void run(), 60_000);
    timer = setInterval(() => void run(), TICK_INTERVAL_MS);
  });

  fastify.addHook('onClose', async () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    fastify.log.info('Milestone deadline scheduler: fermato');
  });
}
