/**
 * Automatic MILESTONE revisions of a CollectionLayout, driven by phase-linked calendar events.
 *
 * Two independent triggers, one revision type each:
 * - `MILESTONE_DATA` — the event's deadline (`endAt ?? startAt`) has been reached. Evaluated on the
 *   hourly milestone-deadline tick.
 * - `MILESTONE_FASE` — every row of the event's planning group has reached (or passed) the event's
 *   phase. Evaluated inline on a row phase transition.
 *
 * A revision always snapshots the *whole* layout (see `createRevision`) regardless of which planning
 * group the triggering event belongs to — the group only shows up in the revision notes, alongside
 * the event title.
 *
 * Dedup is a `(milestoneId, revisionTypeValue)` existence query backed by the unique index of the
 * same shape: the query keeps the common case cheap (no wasted snapshot work), the index closes the
 * window where two concurrent triggers both pass it. Losing that race surfaces as P2002 and is
 * treated as "already done", not as an error. Manual revisions are untouched — their `milestoneId`
 * is null, and Postgres treats NULLs as distinct in a unique index.
 *
 * A row photo gone from storage does not fail a revision (see `createRevision`); any other failure
 * does, and is logged. The date trigger tries again every tick while the event is within the
 * lookback, so a failure lasting the whole window loses that revision; the phase trigger does not
 * retry, and the group's next phase change snapshots the layout as it is then.
 */

import { DEADLINE_REACH_MARGIN_MS, deadlineReachedAt } from '@luke/core';
import { Prisma } from '@luke/db';
import type { PrismaClient } from '@luke/db';

import { copyToImmutableBucket } from '../storage/index.js';

import { createRevision } from './collectionLayoutRevision.service.js';


/**
 * Labels stamped on the revisions these triggers create. They are display text, not a contract:
 * the revision pages print `revisionTypeValue` verbatim and nothing joins them to the
 * `revisionType` catalog, so no seed row has to exist for them to work. Only the dedup key
 * `@@unique([milestoneId, revisionTypeValue])` depends on them staying stable.
 */
export const AUTO_REVISION_TYPE_DATE = 'MILESTONE_DATA';
export const AUTO_REVISION_TYPE_PHASE = 'MILESTONE_FASE';

/**
 * How far back the date trigger looks. Bounds the first tick after deploy (and after any long
 * downtime) so historical events don't each generate a retroactive snapshot.
 */
const REACHED_LOOKBACK_DAYS = 7;

/** Minimal logger surface — callers pass `fastify.log` or nothing. */
type ServiceLogger = {
  warn: (obj: object, msg: string) => void;
  info: (obj: object, msg: string) => void;
};

type TriggerEvent = {
  id: string;
  title: string;
  planningGroupName: string;
  collectionLayoutId: string;
};

/**
 * Resolves the user credited for a system-generated revision: `createdByUserId` is a non-nullable
 * `Restrict` FK and these triggers have no session. Oldest active admin, stable across ticks.
 *
 * @returns The actor id, or null when no active admin exists (caller skips the revision).
 */
async function resolveSystemActorUserId(prisma: PrismaClient): Promise<string | null> {
  const admin = await prisma.user.findFirst({
    where: { role: 'admin', isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return admin?.id ?? null;
}

/** Filters out events that already have a revision of `revisionTypeValue`. */
async function withoutExistingRevision(
  prisma: PrismaClient,
  events: TriggerEvent[],
  revisionTypeValue: string,
): Promise<TriggerEvent[]> {
  if (events.length === 0) return [];
  const existing = await prisma.collectionLayoutRevision.findMany({
    where: { milestoneId: { in: events.map(e => e.id) }, revisionTypeValue },
    select: { milestoneId: true },
  });
  const done = new Set(existing.map(r => r.milestoneId));
  return events.filter(e => !done.has(e.id));
}

/** True when the error is the `(milestoneId, revisionTypeValue)` unique violation. */
function isDuplicateRevision(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Creates the revision and its audit trail. `logAudit` needs a tRPC context (request log, trace id,
 * ip) that no automatic trigger has, so the audit row is written directly — same shape, null actor
 * metadata aside.
 *
 * @returns True when the revision was created, false when a concurrent trigger got there first —
 *   the `(milestoneId, revisionTypeValue)` unique index is what makes the dedup read-check safe,
 *   and losing that race is a no-op, not a failure.
 */
async function createAutoRevision(
  prisma: PrismaClient,
  event: TriggerEvent,
  revisionTypeValue: string,
  notes: string,
  actorUserId: string,
  logger?: ServiceLogger,
): Promise<boolean> {
  let created;
  try {
    created = await createRevision(
      {
        collectionLayoutId: event.collectionLayoutId,
        revisionTypeValue,
        cause: 'MILESTONE',
        milestoneId: event.id,
        notes,
      },
      actorUserId,
      // Into the immutable revisions bucket, as a manual revision does: every reader resolves a
      // revision's `pictureKey` there, and the live object goes when the row photo is replaced.
      sourceKey => copyToImmutableBucket(prisma, sourceKey),
      prisma,
    );
  } catch (err) {
    if (isDuplicateRevision(err)) return false;
    throw err;
  }
  const { revision, missingPhotoRowIds } = created;
  if (missingPhotoRowIds.length > 0) {
    logger?.warn({ revisionId: revision.id, missingPhotoRowIds }, 'Auto-revision created without the row photos gone from storage');
  }

  await prisma.auditLog.create({
    data: {
      actorId: actorUserId,
      action: 'COLLECTION_LAYOUT_REVISION_AUTO_CREATE',
      targetType: 'CollectionLayoutRevision',
      targetId: revision.id,
      result: 'SUCCESS',
      metadata: {
        revisionNumber: revision.revisionNumber,
        revisionTypeValue,
        eventId: event.id,
        collectionLayoutId: event.collectionLayoutId,
        missingPhotoRowIds: missingPhotoRowIds.length > 0 ? missingPhotoRowIds : undefined,
      },
    },
  });

  return true;
}

// ─── Trigger A: event deadline reached ────────────────────────────────────────

/**
 * Snapshots the layout of every phase-linked calendar event whose deadline was reached within the
 * lookback window and that has no `MILESTONE_DATA` revision yet — reached as `deadlineReachedAt`
 * defines it in the business zone (an all-day deadline at the end of its day). Events whose
 * brand+season has no collection layout are skipped.
 *
 * Failures are per-event: one broken layout never blocks the others.
 *
 * @returns The number of revisions created.
 */
export async function createRevisionsForReachedEvents(
  prisma: PrismaClient,
  now: Date,
  timeZone: string,
  logger?: ServiceLogger,
): Promise<number> {
  const lookbackFrom = new Date(now.getTime() - REACHED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  // A superset: a deadline is reached up to DEADLINE_REACH_MARGIN_MS after its stored value, never
  // before, so the exact window is applied below on the reached instant.
  const storedFrom = new Date(lookbackFrom.getTime() - DEADLINE_REACH_MARGIN_MS);

  const fetched = await prisma.calendarEvent.findMany({
    where: {
      cancelledAt: null,
      phaseId: { not: null },
      // The stored deadline is endAt when set, startAt otherwise — two mutually exclusive branches.
      OR: [
        { endAt: { gte: storedFrom, lte: now } },
        { endAt: null, startAt: { gte: storedFrom, lte: now } },
      ],
    },
    select: {
      id: true,
      title: true,
      startAt: true,
      endAt: true,
      allDay: true,
      planningGroup: { select: { name: true } },
      calendar: { select: { brandId: true, seasonId: true } },
    },
  });
  const events = fetched.filter(e => {
    const reachedAt = deadlineReachedAt(e, timeZone);
    return reachedAt >= lookbackFrom && reachedAt <= now;
  });
  if (events.length === 0) return 0;

  const layouts = await prisma.collectionLayout.findMany({
    where: {
      OR: events.map(e => ({ brandId: e.calendar.brandId, seasonId: e.calendar.seasonId })),
    },
    select: { id: true, brandId: true, seasonId: true },
  });
  const layoutByScope = new Map(layouts.map(l => [`${l.brandId}:${l.seasonId}`, l.id]));

  const candidates: TriggerEvent[] = events.flatMap(e => {
    const collectionLayoutId = layoutByScope.get(`${e.calendar.brandId}:${e.calendar.seasonId}`);
    if (!collectionLayoutId) return [];
    return [{ id: e.id, title: e.title, planningGroupName: e.planningGroup.name, collectionLayoutId }];
  });

  const pending = await withoutExistingRevision(prisma, candidates, AUTO_REVISION_TYPE_DATE);
  if (pending.length === 0) return 0;

  const actorUserId = await resolveSystemActorUserId(prisma);
  if (!actorUserId) {
    logger?.warn({ pending: pending.length }, 'Auto-revision skipped: no active admin to credit');
    return 0;
  }

  let created = 0;
  for (const event of pending) {
    try {
      const done = await createAutoRevision(
        prisma,
        event,
        AUTO_REVISION_TYPE_DATE,
        `Evento raggiunto: "${event.title}" — Gruppo: "${event.planningGroupName}"`,
        actorUserId,
        logger,
      );
      if (done) created += 1;
    } catch (err) {
      logger?.warn({ err, eventId: event.id }, 'Auto-revision (deadline reached) failed');
    }
  }

  if (created > 0) logger?.info({ created }, 'Auto-revisions created for reached events');
  return created;
}

// ─── Trigger B: phase completed by every row of the planning group ────────────

/**
 * Snapshots the layout for every phase-linked event of `planningGroupId` whose phase the group has
 * fully cleared — i.e. every row in the group sits at a phase of equal or higher `order`. A single
 * row without a phase means nothing is complete yet.
 *
 * Called after a row phase transition. Never throws: a revision failure must not fail the row save.
 * Unlike the date trigger, the first failure ends the call: every pending event snapshots the same
 * layout, so the next one would fail the same way while the row save waits.
 *
 * @returns The number of revisions created.
 */
export async function createRevisionsForCompletedPhase(
  prisma: PrismaClient,
  collectionLayoutId: string,
  planningGroupId: string,
  logger?: ServiceLogger,
): Promise<number> {
  try {
    const rows = await prisma.collectionLayoutRow.findMany({
      where: { collectionLayoutId, planningGroupId },
      select: { phase: { select: { order: true } } },
    });
    if (rows.length === 0 || rows.some(r => !r.phase)) return 0;
    const minOrder = Math.min(...rows.map(r => r.phase!.order));

    const events = await prisma.calendarEvent.findMany({
      where: {
        planningGroupId,
        cancelledAt: null,
        phase: { order: { lte: minOrder } },
      },
      select: { id: true, title: true, planningGroup: { select: { name: true } } },
    });

    const candidates: TriggerEvent[] = events.map(e => ({
      id: e.id,
      title: e.title,
      planningGroupName: e.planningGroup.name,
      collectionLayoutId,
    }));

    const pending = await withoutExistingRevision(prisma, candidates, AUTO_REVISION_TYPE_PHASE);
    if (pending.length === 0) return 0;

    const actorUserId = await resolveSystemActorUserId(prisma);
    if (!actorUserId) {
      logger?.warn({ pending: pending.length }, 'Auto-revision skipped: no active admin to credit');
      return 0;
    }

    let created = 0;
    for (const event of pending) {
      const done = await createAutoRevision(
        prisma,
        event,
        AUTO_REVISION_TYPE_PHASE,
        `Fase completata: "${event.title}" — Gruppo: "${event.planningGroupName}"`,
        actorUserId,
        logger,
      );
      if (done) created += 1;
    }
    return created;
  } catch (err) {
    logger?.warn({ err, collectionLayoutId, planningGroupId }, 'Auto-revision (phase completed) failed');
    return 0;
  }
}
