import { buildCalendarSummary, createCalendar } from '../google/calendars.js';
import { createEvent, deleteEvent, updateEvent } from '../google/events.js';
import { syncCalendarReaders } from '../google/acl.js';
import { computeContentHash } from './hash.js';
import type { MilestoneForSync, SyncContext } from './types.js';

const PLANNING_SECTION_LABELS: Record<string, string> = {
  'planning.sales': 'Vendite',
  'planning.product': 'Prodotto',
  'planning.sourcing': 'Sourcing',
  'planning.merchandising': 'Merchandising',
};

function milestoneStatusToGoogle(status: string): 'confirmed' | 'tentative' | 'cancelled' {
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'PLANNED') return 'tentative';
  return 'confirmed';
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const code = (err as { code?: number }).code;
      // 4xx (except 429) = do not retry
      if (code !== undefined && code >= 400 && code < 500 && code !== 429) throw err;
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastErr;
}

export async function syncMilestone(
  milestone: MilestoneForSync,
  ctx: SyncContext
): Promise<void> {
  const contentHash = computeContentHash(milestone);
  const existingMappings = await ctx.getMappings(milestone.id);
  const mappingBySectionKey = new Map(existingMappings.map(m => [m.sectionKey, m]));

  for (const sectionKey of milestone.visibleSectionKeys) {
    if (!milestone.publishExternally) {
      const existing = mappingBySectionKey.get(sectionKey);
      if (existing) {
        await withRetry(() => deleteEvent(existing.googleCalendarId, existing.googleEventId));
        await ctx.deleteMapping(milestone.id, sectionKey);
      }
      continue;
    }

    const existing = mappingBySectionKey.get(sectionKey);
    if (existing && existing.contentHash === contentHash) continue;

    const binding = await ctx.getOrCreateBinding(sectionKey);
    const eventInput = {
      title: milestone.title,
      description: milestone.description ?? undefined,
      startAt: milestone.startAt,
      endAt: milestone.endAt ?? undefined,
      allDay: milestone.allDay,
      status: milestoneStatusToGoogle(milestone.status),
    };

    if (existing) {
      await withRetry(() => updateEvent(existing.googleCalendarId, existing.googleEventId, eventInput));
      await ctx.upsertMapping({
        milestoneId: milestone.id,
        sectionKey,
        googleEventId: existing.googleEventId,
        googleCalendarId: existing.googleCalendarId,
        contentHash,
      });
    } else {
      const googleEventId = await withRetry(() => createEvent(binding.googleCalendarId, eventInput));
      await ctx.upsertMapping({
        milestoneId: milestone.id,
        sectionKey,
        googleEventId,
        googleCalendarId: binding.googleCalendarId,
        contentHash,
      });
    }
  }

  // Remove mappings for sections no longer in visibleSectionKeys
  const visibleSet = new Set(milestone.visibleSectionKeys);
  for (const [sectionKey, mapping] of mappingBySectionKey) {
    if (!visibleSet.has(sectionKey as never)) {
      await withRetry(() => deleteEvent(mapping.googleCalendarId, mapping.googleEventId));
      await ctx.deleteMapping(milestone.id, sectionKey);
    }
  }
}

export async function provisionBinding(
  ctx: SyncContext,
  sectionKey: string
): Promise<string> {
  const sectionLabel = PLANNING_SECTION_LABELS[sectionKey] ?? sectionKey;
  const summary = buildCalendarSummary(ctx.brandCode, ctx.seasonCode, sectionLabel);
  const { id: googleCalendarId } = await createCalendar(summary);
  await syncCalendarReaders(googleCalendarId, ctx.allowedUserEmails);
  return googleCalendarId;
}
