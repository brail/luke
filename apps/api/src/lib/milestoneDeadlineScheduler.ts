import {
  DEADLINE_REACH_MARGIN_MS,
  calendarDateIn,
  calendarDaysBetween,
  calendarLink,
  deadlineDay,
  deadlineReachedAt,
  type CalendarEventKey,
} from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { resolveEventAudience } from '../services/calendarAudience.service';
import { createRevisionsForReachedEvents } from '../services/collectionLayoutAutoRevision.service';
import { computeCriticalityForLayout, resolveAlertContext, type AlertContext } from '../services/phaseAlert.service';

import { guardMaintenance } from './maintenanceMode';
import { brandSeasonLabel, insertNotifications, notifyDeduped, recipientsOf } from './notifications';
import { withSchedulerLock } from './schedulerLock';

import type { FastifyInstance } from 'fastify';

const TICK_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Dedup keys name the occurrence (`Notice.occurrence`), so this only has to outlive one overdue
 * stage, three days — as must `notification.dedupRetentionDays`, or a stage is repeated.
 */
const NOTICE_DEDUP_MS = 7 * DAY_MS;

/** Rows late on a phase are notified on days 0–2 after the deadline's day is reached, and again on days 3–5. */
const OVERDUE_SECOND_STAGE = 3;
const OVERDUE_DAYS = 2 * OVERDUE_SECOND_STAGE;

/** "scade …" by calendar days to the deadline's day (0, 1, 2); further out is not notified yet. */
const UPCOMING_LABELS = ['oggi', 'domani', 'tra 2 giorni'];

/** Rows a phase-overdue notice names before "e altre N". */
const PHASE_ROWS_LISTED = 10;

export type DeadlineState =
  | { type: 'upcoming'; daysLeft: number; occurrence: string }
  | { type: 'overdue'; occurrence: string };
type UpcomingState = Extract<DeadlineState, { type: 'upcoming' }>;
type OverdueState = Extract<DeadlineState, { type: 'overdue' }>;

/** A notice about one event, sent once per recipient and occurrence (`sendNotice`). */
interface Notice {
  eventKey: CalendarEventKey;
  title: string;
  message: string;
  link: string;
  data: Record<string, unknown>;
  /** Which occurrence of the notice this is: the dedup ledger's key. */
  occurrence: string;
}

/** An event of a calendar not archived, with something to notify in `state` (`deadlineState`). */
interface DueEvent<S extends DeadlineState> {
  id: string;
  title: string;
  phaseId: string | null;
  calendar: { brandId: string; seasonId: string };
  /** Its calendar's "brand · season", for the message. */
  context: string;
  state: S;
}

/**
 * Where an event's deadline stands at `now`, or nothing to notify. Measured on the deadline
 * (`endAt ?? startAt`) in the business zone the way every other consumer measures it: upcoming
 * while it is not reached and its day is at most two calendar days away, one occurrence a day;
 * overdue from the day it is reached (`deadlineReachedAt`, the day after an all-day deadline), one
 * occurrence on days 0–2 and one on days 3–5, then nothing — a tick missed on the first day of a
 * stage catches up later in it. Pure.
 */
export function deadlineState(
  m: { startAt: Date; endAt: Date | null; allDay: boolean },
  now: Date,
  timeZone: string,
): DeadlineState | null {
  const today = calendarDateIn(now, timeZone);
  const reachedAt = deadlineReachedAt(m, timeZone);
  if (reachedAt <= now) {
    const reachedDay = calendarDateIn(reachedAt, timeZone);
    const days = calendarDaysBetween(reachedDay, today);
    if (days >= OVERDUE_DAYS) return null;
    return { type: 'overdue', occurrence: `overdue:${reachedDay}:${days < OVERDUE_SECOND_STAGE ? 0 : OVERDUE_SECOND_STAGE}` };
  }
  const due = deadlineDay(m, timeZone);
  const daysLeft = calendarDaysBetween(today, due);
  return daysLeft < UPCOMING_LABELS.length ? { type: 'upcoming', daysLeft, occurrence: `upcoming:${due}:${daysLeft}` } : null;
}

/**
 * The notice that event `e`'s deadline is coming, in `state`. Pure. Nothing is sent about an event
 * once its deadline has passed: an event has no completion state, so only the rows late on its
 * phase are worth a notice (`phaseOverdueNotice`, #171).
 */
export function upcomingNotice(e: { id: string; title: string; context: string }, state: UpcomingState): Notice {
  return {
    eventKey: 'CALENDAR_DEADLINE_UPCOMING',
    title: 'Milestone in scadenza',
    message: `"${e.title}" scade ${UPCOMING_LABELS[state.daysLeft]} · ${e.context}`,
    link: calendarLink({ eventId: e.id }),
    data: { milestoneId: e.id, type: 'deadline_upcoming' },
    occurrence: state.occurrence,
  };
}

/**
 * The notice that the rows `lines` have not completed event `e`'s phase by its deadline, in
 * `state`: one per event, naming the first `PHASE_ROWS_LISTED` rows after the event and its
 * calendar, which a reader clamped to two lines still sees. Pure.
 */
export function phaseOverdueNotice(e: { id: string; title: string; context: string }, lines: string[], state: OverdueState): Notice {
  const more = lines.length > PHASE_ROWS_LISTED ? ` e altre ${lines.length - PHASE_ROWS_LISTED}` : '';
  return {
    eventKey: 'CALENDAR_PHASE_OVERDUE',
    title: 'Fase scaduta',
    message: lines.length === 1
      ? `"${lines[0]}" non ha completato "${e.title}" entro la scadenza · ${e.context}`
      : `${lines.length} righe non hanno completato "${e.title}" entro la scadenza · ${e.context}: ${lines.slice(0, PHASE_ROWS_LISTED).join(', ')}${more}`,
    link: '/product/collection-layout',
    data: { eventId: e.id, type: 'phase_overdue' },
    occurrence: `phase_${state.occurrence}`,
  };
}

/**
 * Sends `notice` about event `eventId` to those of `userIds` who receive its kind, each once per
 * occurrence. Those who muted it are left out before the dedup ledger, so unmuting it brings the
 * occurrence still running.
 */
async function sendNotice(prisma: PrismaClient, eventId: string, userIds: string[], notice: Notice): Promise<void> {
  const { occurrence, eventKey, ...row } = notice;
  const recipients = await recipientsOf(prisma, userIds, 'CALENDAR', eventKey);
  await Promise.all(recipients.map(userId =>
    notifyDeduped(prisma, `milestone:${userId}:${eventId}:${occurrence}`, NOTICE_DEDUP_MS, () =>
      insertNotifications(prisma, [{ userId, category: 'CALENDAR', ...row }]))
  ));
}

/**
 * One phase-overdue notice per overdue event of `overdue`, naming the rows still at its phase —
 * `computeCriticalityForLayout`, the engine behind the Controllo dashboards, no new calculation —
 * on the event's overdue occurrences (`deadlineState`); nothing for an event no row is late on.
 * Concluded rows are left out: they carry a frozen outcome instead of a countdown, and nagging
 * about a deadline on work someone already closed is noise.
 */
async function checkRowPhaseOverdue(
  prisma: PrismaClient,
  now: Date,
  alert: AlertContext,
  overdue: DueEvent<OverdueState>[],
  audience: Map<string, string[]>,
): Promise<void> {
  if (overdue.length === 0) return;
  // One calendar and one layout per brand and season: the layouts these events drive.
  const layouts = await prisma.collectionLayout.findMany({
    where: { OR: overdue.map(e => ({ brandId: e.calendar.brandId, seasonId: e.calendar.seasonId })) },
    select: { id: true },
  });
  const overdueIds = new Set(overdue.map(e => e.id));
  const lateRows = (
    await Promise.all(layouts.map(l => computeCriticalityForLayout(l.id, now, prisma, alert, { activeOnly: true })))
  )
    .flat()
    // Type predicate, not a plain boolean: the criticality result is a union and only the 'active'
    // arm carries `eventId`.
    .filter((r): r is Extract<typeof r, { state: 'active' }> => r.state === 'active' && overdueIds.has(r.eventId));
  if (lateRows.length === 0) return;

  const rows = await prisma.collectionLayoutRow.findMany({
    where: { id: { in: lateRows.map(r => r.rowId) } },
    select: { id: true, line: true },
  });
  const lineByRowId = new Map(rows.map(r => [r.id, r.line]));
  const linesByEvent = new Map<string, string[]>();
  for (const r of lateRows) {
    const line = lineByRowId.get(r.rowId) ?? r.rowId;
    const lines = linesByEvent.get(r.eventId);
    if (lines) lines.push(line);
    else linesByEvent.set(r.eventId, [line]);
  }

  await Promise.all(overdue.flatMap(e => {
    const lines = linesByEvent.get(e.id);
    // Natural order, so "Linea 2" comes before "Linea 10" and the ten named are the first ten.
    return lines
      ? [sendNotice(prisma, e.id, audience.get(e.id) ?? [], phaseOverdueNotice(e, lines.sort((a, b) => a.localeCompare(b, 'it', { numeric: true })), e.state))]
      : [];
  }));
}

/**
 * One tick: the deadline notices of calendars not archived — an archived calendar is over; a draft
 * one is live in practice, nothing in the app moves a calendar to ACTIVE — and the layout
 * auto-revisions. Exported for its integration test.
 */
export async function checkDeadlines(prisma: PrismaClient, logger: FastifyInstance['log'], now = new Date()): Promise<void> {
  const alert = await resolveAlertContext(prisma);
  const { timeZone } = alert;

  // A superset of stored deadlines: reached no earlier than the first day of the overdue window
  // (a day back for a DST change, then the reach margin), and on a day no later than today + 2
  // (plus a day of slack). Exact rules in `deadlineState`.
  const storedFrom = new Date(now.getTime() - (OVERDUE_DAYS + 1) * DAY_MS - DEADLINE_REACH_MARGIN_MS);
  const storedTo = new Date(now.getTime() + 4 * DAY_MS);
  const events = await prisma.calendarEvent.findMany({
    where: {
      cancelledAt: null,
      calendar: { status: { not: 'ARCHIVED' } },
      OR: [
        { endAt: { gte: storedFrom, lte: storedTo } },
        { endAt: null, startAt: { gte: storedFrom, lte: storedTo } },
      ],
    },
    select: {
      id: true, title: true, startAt: true, endAt: true, allDay: true, phaseId: true,
      calendar: { select: { brandId: true, seasonId: true, brand: { select: { name: true } }, season: { select: { name: true } } } },
    },
  });

  const upcoming: DueEvent<UpcomingState>[] = [];
  const overdue: DueEvent<OverdueState>[] = [];
  for (const e of events) {
    const state = deadlineState(e, now, timeZone);
    const due = { ...e, context: brandSeasonLabel(e.calendar) };
    if (state?.type === 'upcoming') upcoming.push({ ...due, state });
    // Past its deadline, only an event with a phase has something to say: the rows late on it.
    else if (state && e.phaseId) overdue.push({ ...due, state });
  }
  const notify = async () => {
    const audience = await resolveEventAudience([...upcoming, ...overdue].map(e => e.id), prisma);
    await Promise.all([
      ...upcoming.map(e => sendNotice(prisma, e.id, audience.get(e.id) ?? [], upcomingNotice(e, e.state))),
      checkRowPhaseOverdue(prisma, now, alert, overdue, audience),
    ]);
  };

  await Promise.all([
    notify(),
    // Auto-revision of the collection layout for every phase-linked event whose deadline was reached:
    // beside the notices, not after their audience, so a failure there does not skip it.
    createRevisionsForReachedEvents(prisma, now, timeZone, logger),
  ]);
}

/**
 * Registers the milestone deadline notification scheduler as a Fastify plugin: an hourly
 * `checkDeadlines`. The first check runs 60 seconds after server ready to avoid boot-time noise.
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
