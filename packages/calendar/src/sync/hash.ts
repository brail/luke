import { createHash } from 'node:crypto';

import type { MilestoneForSync } from './types.js';

/**
 * Computes a deterministic 32-character hex hash of the milestone fields that
 * affect the Google Calendar event. Used to detect whether an event needs to
 * be updated without fetching it from Google.
 *
 * Hashed fields: `title`, `description`, `startAt`, `endAt`, `allDay`, `cancelled`,
 * and `visibilityFunctionIds` (sorted for stability).
 *
 * @returns First 32 hex characters of the SHA-256 hash
 */
export function computeContentHash(milestone: MilestoneForSync): string {
  const payload = JSON.stringify({
    title: milestone.title,
    description: milestone.description,
    startAt: milestone.startAt.toISOString(),
    endAt: milestone.endAt?.toISOString() ?? null,
    allDay: milestone.allDay,
    cancelled: milestone.cancelled,
    visibilityFunctionIds: [...milestone.visibilityFunctionIds].sort(),
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}
