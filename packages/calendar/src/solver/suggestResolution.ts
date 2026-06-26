import { daysBetween, addDays } from '@luke/core';

import { buildGraph } from './graph.js';
import { topologicalSort } from './topologicalSort.js';
import type { GraphInput, ProposedShift } from './types.js';

// Forward propagation greedy resolution. Returns null if overconstrained (maxGapDays HARD violated).
export function suggestResolution(
  input: GraphInput,
  shifts: ProposedShift[],
): ProposedShift[] | null {
  const { eventMap, predecessorsOf } = buildGraph(input);

  let sortedIds: string[];
  try {
    sortedIds = topologicalSort(input.events.map(e => e.id), input.dependencies);
  } catch {
    return null; // cycle — caller should run detectViolations first
  }

  const shiftMap = new Map(shifts.map(s => [s.eventId, s.toStartAt]));

  const workingStartAt = new Map<string, Date>();
  const workingEndAt   = new Map<string, Date>();

  for (const event of input.events) {
    const start = shiftMap.get(event.id) ?? event.startAt;
    workingStartAt.set(event.id, start);

    if (event.endAt) {
      const delta = daysBetween(event.startAt, start);
      const end = addDays(event.endAt, delta);
      workingEndAt.set(event.id, end);
    } else {
      workingEndAt.set(event.id, start);
    }
  }

  const result: ProposedShift[] = [];

  for (const eventId of sortedIds) {
    const event = eventMap.get(eventId);
    if (!event) continue;

    const preds = predecessorsOf.get(eventId) ?? [];
    const hardPreds = preds.filter(d => d.severity === 'HARD' && !d.isDisabled);

    let earliestStart = workingStartAt.get(eventId)!;

    for (const dep of hardPreds) {
      const predEnd = workingEndAt.get(dep.predecessorId);
      if (!predEnd) continue;

      const requiredStart = dep.minGapDays ? addDays(predEnd, dep.minGapDays) : predEnd;
      if (requiredStart > earliestStart) {
        earliestStart = requiredStart;
      }
    }

    const currentStart = workingStartAt.get(eventId)!;
    if (earliestStart > currentStart) {
      const originalStart = shiftMap.get(eventId) ?? event.startAt;
      const deltaDays = daysBetween(currentStart, earliestStart);
      const reason = `Spostato +${deltaDays}gg per rispettare gap minimo da predecessori HARD`;

      result.push({
        eventId,
        fromStartAt: originalStart,
        toStartAt: earliestStart,
        reason,
      });

      // Update working maps
      workingStartAt.set(eventId, earliestStart);
      if (event.endAt) {
        const delta = daysBetween(event.startAt, earliestStart);
        workingEndAt.set(eventId, addDays(event.endAt, delta));
      } else {
        workingEndAt.set(eventId, earliestStart);
      }
    }
  }

  // Check maxGapDays HARD after propagation
  const { activeDeps } = buildGraph(input);
  for (const dep of activeDeps) {
    if (dep.severity !== 'HARD' || dep.maxGapDays === undefined || dep.maxGapDays === null) continue;

    const predEnd   = workingEndAt.get(dep.predecessorId);
    const succStart = workingStartAt.get(dep.successorId);
    if (!predEnd || !succStart) continue;

    const actualGap = daysBetween(predEnd, succStart);
    if (actualGap > dep.maxGapDays) {
      return null; // overconstrained
    }
  }

  return result;
}
