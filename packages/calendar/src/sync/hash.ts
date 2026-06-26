import { createHash } from 'node:crypto';

import type { MilestoneForSync } from './types.js';

export function computeContentHash(milestone: MilestoneForSync): string {
  const payload = JSON.stringify({
    title: milestone.title,
    description: milestone.description,
    startAt: milestone.startAt.toISOString(),
    endAt: milestone.endAt?.toISOString() ?? null,
    allDay: milestone.allDay,
    status: milestone.status,
    visibilityFunctionIds: [...milestone.visibilityFunctionIds].sort(),
  });
  return createHash('sha256').update(payload).digest('hex').slice(0, 32);
}
