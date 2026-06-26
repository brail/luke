import type { DependencySeverity, EventSeverity, WorkingDayHoliday } from '@luke/core';

export interface SolverEvent {
  id: string;
  startAt: Date;
  endAt: Date | null;
  relevantCountries: string[];
  severity: EventSeverity;
}

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

export type SolverHoliday = WorkingDayHoliday;

export interface GraphInput {
  events:       SolverEvent[];
  dependencies: SolverDependency[];
  holidays:     SolverHoliday[];
}

export interface Violation {
  type:          'GAP_MIN' | 'GAP_MAX' | 'HOLIDAY_OVERLAP' | 'CYCLE_DETECTED' | 'OVERCONSTRAINED';
  severity:      'HARD' | 'SOFT';
  eventIds:      string[];
  dependencyId?: string;
  details:       string;
  causalChain?:  string[];
}

export interface ProposedShift {
  eventId:     string;
  fromStartAt: Date;
  toStartAt:   Date;
  reason:      string;
}

export interface SimulationResult {
  violations: Violation[];
  suggestion: ProposedShift[] | null;
}
