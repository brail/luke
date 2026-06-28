import type { DependencySeverity, EventSeverity, WorkingDayHoliday } from '@luke/core';

/**
 * A calendar event as consumed by the dependency solver.
 * Contains only the fields the solver needs; all other milestone data stays in the DB layer.
 */
export interface SolverEvent {
  id: string;
  startAt: Date;
  endAt: Date | null;
  relevantCountries: string[];
  severity: EventSeverity;
}

/**
 * A directed dependency edge between two solver events.
 * Encodes optional minimum/maximum gap constraints and whether the edge is
 * currently inactive (disabled by the user).
 */
export interface SolverDependency {
  id: string;
  predecessorId: string;
  successorId: string;
  minGapDays?: number;
  maxGapDays?: number;
  severity: DependencySeverity;
  reason?: string;
  isDisabled: boolean;
}

/**
 * A public holiday used to detect event/holiday overlaps in the solver.
 * Re-exported from `@luke/core` for use without a direct core dependency.
 */
export type SolverHoliday = WorkingDayHoliday;

/**
 * Full input to the dependency solver: the set of events, their dependency
 * edges, and the holidays relevant for overlap detection.
 */
export interface GraphInput {
  events:       SolverEvent[];
  dependencies: SolverDependency[];
  holidays:     SolverHoliday[];
}

/**
 * A constraint violation detected by the solver.
 * `HARD` violations must be resolved before publishing; `SOFT` violations are warnings.
 */
export interface Violation {
  type:          'GAP_MIN' | 'GAP_MAX' | 'HOLIDAY_OVERLAP' | 'CYCLE_DETECTED' | 'OVERCONSTRAINED';
  severity:      'HARD' | 'SOFT';
  eventIds:      string[];
  dependencyId?: string;
  details:       string;
  causalChain?:  string[];
}

/**
 * A proposed date shift for a single event, produced by `suggestResolution`.
 */
export interface ProposedShift {
  eventId:     string;
  fromStartAt: Date;
  toStartAt:   Date;
  reason:      string;
}

/**
 * Combined output of a solver simulation: the list of detected violations and,
 * when resolvable, the greedy set of proposed shifts.
 * `suggestion` is `null` when the graph is over-constrained or cyclic.
 */
export interface SimulationResult {
  violations: Violation[];
  suggestion: ProposedShift[] | null;
}
