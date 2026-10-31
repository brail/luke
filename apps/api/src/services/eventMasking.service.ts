/**
 * What names or dates a calendar event, as a given caller may read it. `phaseAlert.service.ts` stays
 * viewer-independent, because the deadline scheduler and `rows.setCompleted` need every event;
 * what leaves the API passes here. A row keeps its band and state, since those measure the
 * row; what names or dates an event the caller cannot list goes.
 */

import type { CalendarDate } from '@luke/core';

import { callerEventVisibility, getAllowedFunctionIds, type BrandScopeCtx } from './brandScope.service';

import type { computeBottleneckByEvent, computeCriticality, HolidayOverlapEntry } from './phaseAlert.service';

type Criticality = NonNullable<Awaited<ReturnType<typeof computeCriticality>>>;
type BottleneckEntry = Awaited<ReturnType<typeof computeBottleneckByEvent>>[number];
type IsVisible = (eventId: string) => boolean;

/** Whether the caller may see each of `eventIds`. An admin sees every event: no query. */
export async function visibilityOf(ctx: BrandScopeCtx, eventIds: string[]): Promise<IsVisible> {
  if ((await getAllowedFunctionIds(ctx)) === null) return () => true;
  if (eventIds.length === 0) return () => false;
  const visible = await ctx.prisma.calendarEvent.findMany({
    where: { id: { in: [...new Set(eventIds)] }, AND: [await callerEventVisibility(ctx)] },
    select: { id: true },
  });
  const ids = new Set(visible.map(e => e.id));
  return eventId => ids.has(eventId);
}

function eventIdsOf(row: Criticality): string[] {
  if (row.state === 'completed') return row.eventId ? [row.eventId] : [];
  return row.nextPhase ? [row.eventId, row.nextPhase.eventId] : [row.eventId];
}

/** What every hidden event loses: its identity, its date, and how its days are counted. */
const HIDDEN_EVENT = {
  eventId: null,
  eventTitle: null,
  deadlineDay: null,
  daysMode: 'calendar' as const,
  relevantCountryCodes: [] as string[],
};

function maskRow(row: Criticality, isVisible: IsVisible) {
  if (row.state === 'completed') {
    const eventHidden = row.eventId !== null && !isVisible(row.eventId);
    return eventHidden
      ? { ...row, ...HIDDEN_EVENT, eventHidden, daysVsDeadline: null }
      : { ...row, eventHidden };
  }
  const { nextPhase } = row;
  const masked = {
    ...row,
    nextPhase: nextPhase && !isVisible(nextPhase.eventId)
      ? { ...nextPhase, ...HIDDEN_EVENT, daysUntil: null }
      : nextPhase,
  };
  return isVisible(row.eventId)
    ? masked
    : { ...masked, ...HIDDEN_EVENT, eventStartDay: null, daysToDeadline: null };
}

/** `computeCriticality`'s answer, for the caller. */
export async function maskCriticality(ctx: BrandScopeCtx, row: Criticality | null) {
  if (!row) return null;
  return maskRow(row, await visibilityOf(ctx, eventIdsOf(row)));
}

/** `computeCriticalityForLayout`'s answer, for the caller. One query for the whole layout. */
export async function maskCriticalityList(ctx: BrandScopeCtx, rows: (Criticality & { productCategory: string })[]) {
  const isVisible = await visibilityOf(ctx, rows.flatMap(eventIdsOf));
  return rows.map(row => ({ ...maskRow(row, isVisible), productCategory: row.productCategory }));
}

/**
 * `computeBottleneckByEvent`'s answer, for the caller: the events they can see, then one reserved
 * entry summing the band counts of the others, which says neither how many they are nor their order.
 */
export async function maskBottleneck(ctx: BrandScopeCtx, entries: BottleneckEntry[]) {
  const isVisible = await visibilityOf(ctx, entries.map(e => e.eventId));
  const shown: { eventId: string | null; eventTitle: string | null; eventStartDay: CalendarDate | null; bands: BottleneckEntry['bands'] }[] =
    entries.filter(e => isVisible(e.eventId));
  const hidden = entries.filter(e => !isVisible(e.eventId));
  if (hidden.length === 0) return shown;

  const bands = new Map<string, BottleneckEntry['bands'][number]>();
  // By id, not in the engine's date order: a label's color is its first event's, and must not tell it.
  for (const band of [...hidden].sort((a, b) => a.eventId.localeCompare(b.eventId)).flatMap(e => e.bands)) {
    const merged = bands.get(band.label);
    bands.set(band.label, merged ? { ...merged, count: merged.count + band.count } : band);
  }
  const mergedBands = [...bands.values()].sort((a, b) => a.label.localeCompare(b.label));
  return [...shown, { eventId: null, eventTitle: null, eventStartDay: null, bands: mergedBands }];
}

interface MilestoneRevision { milestoneId: string | null; notes: string | null }

function maskRevisionWith<R extends MilestoneRevision>(revision: R, isVisible: IsVisible): R {
  return revision.milestoneId === null || isVisible(revision.milestoneId)
    ? revision
    : { ...revision, milestoneId: null, notes: 'Evento riservato' };
}

/**
 * Revisions as the caller may read them. An automatic revision's note names the event it records,
 * and its reference goes with it when the caller cannot list that event, a deleted one included:
 * it has no visibility left to check, so only an admin still reads it. A manual revision has no
 * event: its note is the author's.
 */
export async function maskRevisions<R extends MilestoneRevision>(ctx: BrandScopeCtx, revisions: R[]): Promise<R[]> {
  const isVisible = await visibilityOf(ctx, revisions.flatMap(r => r.milestoneId ?? []));
  return revisions.map(r => maskRevisionWith(r, isVisible));
}

/** `maskRevisions` for one revision. */
export async function maskRevision<R extends MilestoneRevision>(ctx: BrandScopeCtx, revision: R): Promise<R> {
  return maskRevisionWith(revision, await visibilityOf(ctx, revision.milestoneId ? [revision.milestoneId] : []));
}

/**
 * `resolveHolidayOverlapsForGroup`'s answer, for the caller: the entries they can read, and how many
 * other events land on a non-working day. The freeze the warning precedes covers those too.
 */
export async function maskHolidayOverlaps(ctx: BrandScopeCtx, entries: HolidayOverlapEntry[]) {
  const isVisible = await visibilityOf(ctx, entries.map(e => e.eventId));
  return {
    entries: entries.filter(e => isVisible(e.eventId)),
    hiddenCount: new Set(entries.map(e => e.eventId).filter(id => !isVisible(id))).size,
  };
}
