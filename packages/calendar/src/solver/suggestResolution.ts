import { daysBetween, addDays } from '@luke/core';

import { buildGraph } from './graph.js';
import { topologicalSort } from './topologicalSort.js';
import type { GraphInput, ProposedShift } from './types.js';

/**
 * Suggests a minimal set of date shifts that resolves all HARD `minGapDays` violations
 * by forward-propagating each event in topological order.
 *
 * After propagation, verifies that no HARD `maxGapDays` constraint is violated.
 * Returns `null` when the graph is over-constrained (a HARD max-gap would be
 * exceeded) or cyclic (caller should run `detectViolations` first).
 *
 * Only HARD dependencies are used for propagation; SOFT violations are ignored.
 *
 * @param input - Graph input (events, dependencies, holidays)
 * @param shifts - Initial shifts to apply before propagation
 * @returns Array of additional proposed shifts, or `null` if unresolvable
 */
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
