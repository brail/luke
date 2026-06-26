import { daysBetween } from '@luke/core';

import { buildGraph } from './graph.js';
import { topologicalSort } from './topologicalSort.js';
import type { GraphInput, ProposedShift, Violation } from './types.js';

export function detectViolations(
  input: GraphInput,
  shifts: ProposedShift[],
): Violation[] {
  const violations: Violation[] = [];

  // Build shift map
  const shiftMap = new Map(shifts.map(s => [s.eventId, s.toStartAt]));

  // Effective start/end dates (virtual — no mutation of input)
  const effectiveStartAt = new Map<string, Date>();
  const effectiveEndAt   = new Map<string, Date>();

  for (const event of input.events) {
    const newStart = shiftMap.get(event.id) ?? event.startAt;
    const delta = daysBetween(event.startAt, newStart);
    effectiveStartAt.set(event.id, newStart);

    if (event.endAt) {
      const newEnd = new Date(event.endAt);
      newEnd.setDate(newEnd.getDate() + delta);
      effectiveEndAt.set(event.id, newEnd);
    } else {
      effectiveEndAt.set(event.id, newStart);
    }
  }

  // Cycle check
  try {
    topologicalSort(
      input.events.map(e => e.id),
      input.dependencies,
    );
  } catch {
    violations.push({
      type: 'CYCLE_DETECTED',
      severity: 'HARD',
      eventIds: input.events.map(e => e.id),
      details: 'Ciclo rilevato nel grafo delle dipendenze',
    });
    return violations; // can't evaluate other violations on a cyclic graph
  }

  const { activeDeps } = buildGraph(input);

  // Gap violations
  for (const dep of activeDeps) {
    const predEnd  = effectiveEndAt.get(dep.predecessorId);
    const succStart = effectiveStartAt.get(dep.successorId);
    if (!predEnd || !succStart) continue;

    const actualGap = daysBetween(predEnd, succStart);

    if (dep.minGapDays !== undefined && dep.minGapDays !== null && actualGap < dep.minGapDays) {
      violations.push({
        type: 'GAP_MIN',
        severity: dep.severity,
        eventIds: [dep.predecessorId, dep.successorId],
        dependencyId: dep.id,
        details: `Gap ${actualGap}gg < minimo ${dep.minGapDays}gg${dep.reason ? ` (${dep.reason})` : ''}`,
      });
    }

    if (dep.maxGapDays !== undefined && dep.maxGapDays !== null && actualGap > dep.maxGapDays) {
      violations.push({
        type: 'GAP_MAX',
        severity: dep.severity,
        eventIds: [dep.predecessorId, dep.successorId],
        dependencyId: dep.id,
        details: `Gap ${actualGap}gg > massimo ${dep.maxGapDays}gg${dep.reason ? ` (${dep.reason})` : ''}`,
      });
    }
  }

  // Holiday overlap violations (always SOFT)
  for (const event of input.events) {
    if (event.relevantCountries.length === 0) continue;

    const start = effectiveStartAt.get(event.id)!;
    const end   = effectiveEndAt.get(event.id)!;

    const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const endUtc   = Date.UTC(end.getFullYear(),   end.getMonth(),   end.getDate());

    for (const holiday of input.holidays) {
      if (!event.relevantCountries.includes(holiday.countryCode)) continue;

      const hStart = Date.UTC(holiday.startDate.getFullYear(), holiday.startDate.getMonth(), holiday.startDate.getDate());
      const hEnd   = Date.UTC(holiday.endDate.getFullYear(),   holiday.endDate.getMonth(),   holiday.endDate.getDate());

      if (startUtc <= hEnd && endUtc >= hStart) {
        violations.push({
          type: 'HOLIDAY_OVERLAP',
          severity: 'SOFT',
          eventIds: [event.id],
          details: `Evento sovrapposto a festività ${holiday.countryCode}`,
        });
      }
    }
  }

  return violations;
}
