import { initials } from '@luke/core';

import { syncCalendarReaders, enforceDomainReadOnly } from '../google/acl.js';
import { buildCalendarSummary, createCalendar } from '../google/calendars.js';
import { createEvent, deleteEvent, updateEvent } from '../google/events.js';

import { computeContentHash } from './hash.js';

import type { MilestoneForSync, SyncContext } from './types.js';

function milestoneStatusToGoogle(cancelled: boolean): 'confirmed' | 'cancelled' {
  return cancelled ? 'cancelled' : 'confirmed';
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
 * All Google API calls are retried up to 3 times with exponential back-off (skipping 4xx errors).
 *
 * @param milestone - Milestone data and its target function ids
 * @param ctx - Database I/O context (bindings, mappings, brand/season metadata)
 */
export async function syncMilestone(
  milestone: MilestoneForSync,
  ctx: SyncContext
): Promise<void> {
  const contentHash = computeContentHash(milestone);
  const existingMappings = await ctx.getMappings(milestone.id);
  const mappingByFunctionId = new Map(existingMappings.map(m => [m.companyFunctionId, m]));

  for (const companyFunctionId of milestone.visibilityFunctionIds) {
    if (!milestone.publishExternally) {
      const existing = mappingByFunctionId.get(companyFunctionId);
      if (existing) {
        await withRetry(() => deleteEvent(existing.googleCalendarId, existing.googleEventId));
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
      await ctx.upsertMapping({
        eventId: milestone.id,
        companyFunctionId,
        googleEventId: existing.googleEventId,
        googleCalendarId: existing.googleCalendarId,
        contentHash,
      });
    } else {
      const googleEventId = await withRetry(() => createEvent(binding.googleCalendarId, eventInput));
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
      await ctx.deleteMapping(milestone.id, companyFunctionId);
    }
  }
}

/**
 * Creates a new Google Calendar for the given company function and configures
 * reader ACL scoped to that function's team members (plus admins), via `ctx.getAllowedEmailsForFunction`.
 *
 * @param ctx - Sync context providing brand/season codes and the reader-email resolver
 * @param companyFunctionId - Identifier of the company function (used as calendar section label when no label is provided)
 * @param functionLabel - Human-readable section label for the calendar summary (optional)
 * @returns The newly provisioned Google Calendar id
 */
export async function provisionBinding(
  ctx: SyncContext,
  companyFunctionId: string,
  functionLabel?: string
): Promise<string> {
  const label = functionLabel ?? companyFunctionId;
  const summary = buildCalendarSummary(ctx.brandCode, ctx.seasonCode, label);
  const { id: googleCalendarId } = await createCalendar(summary);
  const allowedUserEmails = await ctx.getAllowedEmailsForFunction(companyFunctionId);
  await syncCalendarReaders(googleCalendarId, allowedUserEmails);
  await enforceDomainReadOnly(googleCalendarId);
  return googleCalendarId;
}
