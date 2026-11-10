import { initials } from '@luke/core';

import { createEvent, deleteEvent, updateEvent } from '../google/events.js';
import { withRetry } from '../google/retry.js';

import { computeContentHash } from './hash.js';

import type { MilestoneForSync, SyncContext } from './types.js';

function milestoneStatusToGoogle(cancelled: boolean): 'confirmed' | 'cancelled' {
  return cancelled ? 'cancelled' : 'confirmed';
}

/**
 * Syncs a single milestone to all Google Calendars it should appear in.
 *
 * For each company function in `milestone.visibilityFunctionIds`:
 * - If `publishExternally` is `false`: deletes the existing Google event and mapping if present.
 * - If the existing content hash matches: skips (no-op).
 * - If an existing mapping exists: updates the Google event in place.
 * - Otherwise: provisions the binding if needed, creates the event, and stores the mapping.
 *
 * Also removes mappings for company functions that are no longer in the visibility list.
 * All Google API calls go through `withRetry` (network errors, 5xx and rate limits).
 *
 * @param milestone - Milestone data and its target function ids
 * @param ctx - Database I/O context (bindings, mappings, brand/season metadata)
 * @returns Whether an event was created, updated or deleted on Google: a sync with nothing to
 *   change calls no Google API, so it says nothing about whether Google accepts Luke's requests
 */
export async function syncMilestone(
  milestone: MilestoneForSync,
  ctx: SyncContext
): Promise<boolean> {
  const contentHash = computeContentHash(milestone);
  // A binding is created only right before an event call, so the event calls are enough to tell.
  let calledGoogle = false;
  const existingMappings = await ctx.getMappings(milestone.id);
  const mappingByFunctionId = new Map(existingMappings.map(m => [m.companyFunctionId, m]));

  for (const companyFunctionId of milestone.visibilityFunctionIds) {
    if (!milestone.publishExternally) {
      const existing = mappingByFunctionId.get(companyFunctionId);
      if (existing) {
        await withRetry(() => deleteEvent(existing.googleCalendarId, existing.googleEventId));
        calledGoogle = true;
        await ctx.deleteMapping(milestone.id, companyFunctionId);
      }
      continue;
    }

    const existing = mappingByFunctionId.get(companyFunctionId);
    if (existing && existing.contentHash === contentHash) continue;

    const binding = await ctx.getOrCreateBinding(companyFunctionId);
    const eventInput = {
      title: `[${initials(milestone.planningGroupName)}] ${milestone.title}`,
      description: milestone.description ?? undefined,
      startAt: milestone.startAt,
      endAt: milestone.endAt ?? undefined,
      allDay: milestone.allDay,
      status: milestoneStatusToGoogle(milestone.cancelled),
    };

    if (existing) {
      await withRetry(() => updateEvent(existing.googleCalendarId, existing.googleEventId, eventInput));
      calledGoogle = true;
      await ctx.upsertMapping({
        eventId: milestone.id,
        companyFunctionId,
        googleEventId: existing.googleEventId,
        googleCalendarId: existing.googleCalendarId,
        contentHash,
      });
    } else {
      const googleEventId = await withRetry(() => createEvent(binding.googleCalendarId, eventInput));
      calledGoogle = true;
      await ctx.upsertMapping({
        eventId: milestone.id,
        companyFunctionId,
        googleEventId,
        googleCalendarId: binding.googleCalendarId,
        contentHash,
      });
    }
  }

  // Remove mappings for functions no longer in visibilityFunctionIds
  const visibleSet = new Set(milestone.visibilityFunctionIds);
  for (const [companyFunctionId, mapping] of mappingByFunctionId) {
    if (!visibleSet.has(companyFunctionId)) {
      await withRetry(() => deleteEvent(mapping.googleCalendarId, mapping.googleEventId));
      calledGoogle = true;
      await ctx.deleteMapping(milestone.id, companyFunctionId);
    }
  }
  return calledGoogle;
}
