/**
 * Phase/calendar resolution shared between the anchor UI (Fase 3) and the alert engine (Fase 5).
 * No graph traversal: for a given row, statically filters the events of its season calendar.
 */

import type { PrismaClient } from '@prisma/client';

/**
 * Returns the calendar events that apply to a given collection row, ordered by Phase.order
 * (events without a phase sort last, in startAt order among themselves).
 *
 * Resolution rule per event:
 * 1. No CalendarEventAnchor at all → applies to every row in the layout.
 * 2. Anchored to `COLLECTION_LAYOUT` (the whole layout) → equivalent to case 1.
 * 3. Anchored to one or more `COLLECTION_LAYOUT_ROW` → applies only to those specific rows.
 *
 * @returns Empty array if the row's layout has no season calendar yet.
 */
export async function getApplicableEventsForRow(rowId: string, prisma: PrismaClient) {
  const row = await prisma.collectionLayoutRow.findUnique({
    where: { id: rowId },
    select: { collectionLayout: { select: { brandId: true, seasonId: true } } },
  });
  if (!row) return [];

  const calendar = await prisma.seasonCalendar.findUnique({
    where: { brandId_seasonId: { brandId: row.collectionLayout.brandId, seasonId: row.collectionLayout.seasonId } },
    select: { id: true },
  });
  if (!calendar) return [];

  const events = await prisma.calendarEvent.findMany({
    where: { calendarId: calendar.id },
    include: {
      anchors: { select: { entityType: true, entityId: true } },
      phase: { select: { order: true } },
    },
    // Fetched pre-sorted by startAt: Array.prototype.sort is stable, so events sharing the
    // same Phase.order below keep this chronological order as a secondary sort key.
    orderBy: { startAt: 'asc' },
  });

  const applicable = events.filter(event => {
    if (event.anchors.length === 0) return true;
    if (event.anchors.some(a => a.entityType === 'COLLECTION_LAYOUT')) return true;
    return event.anchors.some(a => a.entityType === 'COLLECTION_LAYOUT_ROW' && a.entityId === rowId);
  });

  return applicable.sort((a, b) => (a.phase?.order ?? Infinity) - (b.phase?.order ?? Infinity));
}
