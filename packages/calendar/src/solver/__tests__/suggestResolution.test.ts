import { describe, it, expect } from 'vitest';

import { suggestResolution } from '../suggestResolution.js';
import { cycleInput } from './fixtures/cycle.js';
import { forkInput } from './fixtures/fork.js';
import { joinInput } from './fixtures/join.js';
import { linearInput } from './fixtures/linear.js';
import { maxGapViolatedInput, overconstrainedInput } from './fixtures/overconstrained.js';

describe('suggestResolution', () => {
  describe('no shifts needed', () => {
    it('returns empty array when all constraints satisfied', () => {
      const result = suggestResolution(linearInput, []);
      expect(result).toEqual([]);
    });
  });

  describe('linear chain A→B→C', () => {
    it('pushes B and C when A is shifted forward', () => {
      // Shift A by +14 days: B is now too close to new A position
      const result = suggestResolution(linearInput, [
        { eventId: 'A', fromStartAt: new Date('2025-01-01'), toStartAt: new Date('2025-01-15'), reason: 'moved A' },
      ]);
      expect(result).not.toBeNull();
      // B must be shifted to at least 2025-01-22 (A end + 7 days)
      const shiftB = result!.find(s => s.eventId === 'B');
      expect(shiftB).toBeDefined();
      expect(shiftB!.toStartAt >= new Date('2025-01-22')).toBe(true);
      // C must be shifted to at least B + 7 days
      const shiftC = result!.find(s => s.eventId === 'C');
      expect(shiftC).toBeDefined();
    });

    it('does not shift events that already satisfy constraints', () => {
      // Shift only A by 1 day — B (Jan 10) is still ≥ Jan 2 + 7 = Jan 9, so no shift needed for B
      const result = suggestResolution(linearInput, [
        { eventId: 'A', fromStartAt: new Date('2025-01-01'), toStartAt: new Date('2025-01-02'), reason: 'moved A slightly' },
      ]);
      expect(result).not.toBeNull();
      // B is on Jan 10, pred end = Jan 2, gap = 8 ≥ 7: no shift
      expect(result!.find(s => s.eventId === 'B')).toBeUndefined();
      expect(result!.find(s => s.eventId === 'C')).toBeUndefined();
    });
  });

  describe('fork A→B, A→C', () => {
    it('shifts both branches when A moves forward', () => {
      const result = suggestResolution(forkInput, [
        { eventId: 'A', fromStartAt: new Date('2025-01-01'), toStartAt: new Date('2025-01-10'), reason: 'moved A' },
      ]);
      expect(result).not.toBeNull();
      const shiftB = result!.find(s => s.eventId === 'B');
      const shiftC = result!.find(s => s.eventId === 'C');
      expect(shiftB).toBeDefined();
      expect(shiftC).toBeDefined();
    });
  });

  describe('join A→C, B→C', () => {
    it('C pushed to satisfy the latest predecessor', () => {
      // Shift A by +10 days: A end = Jan 11, so C must be ≥ Jan 21. B end = Jan 5, C needs ≥ Jan 15 from B.
      // Latest requirement is from A: Jan 21
      const result = suggestResolution(joinInput, [
        { eventId: 'A', fromStartAt: new Date('2025-01-01'), toStartAt: new Date('2025-01-11'), reason: 'moved A' },
      ]);
      expect(result).not.toBeNull();
      const shiftC = result!.find(s => s.eventId === 'C');
      expect(shiftC).toBeDefined();
      expect(shiftC!.toStartAt >= new Date('2025-01-21')).toBe(true);
    });
  });

  describe('cycle → null', () => {
    it('returns null for cyclic graph', () => {
      expect(suggestResolution(cycleInput, [])).toBeNull();
    });
  });

  describe('overconstrained', () => {
    it('returns null when minGap > maxGap (HARD)', () => {
      // After propagation, minGap forces B forward but maxGap is violated
      const result = suggestResolution(overconstrainedInput, []);
      expect(result).toBeNull();
    });

    it('returns null when maxGapDays HARD violated and cannot be resolved', () => {
      expect(suggestResolution(maxGapViolatedInput, [])).toBeNull();
    });
  });

  describe('SOFT dependencies ignored in resolution', () => {
    it('does not propagate SOFT predecessor violations', () => {
      const softInput = {
        ...linearInput,
        dependencies: [
          { id: 'd1', predecessorId: 'A', successorId: 'B', minGapDays: 100, severity: 'SOFT' as const, isDisabled: false },
        ],
      };
      // Even with a huge SOFT minGap violation, resolution returns empty (no HARD constraint to enforce)
      const result = suggestResolution(softInput, []);
      expect(result).toEqual([]);
    });
  });

  describe('disabled dependencies ignored', () => {
    it('does not push successor when dep is disabled', () => {
      const input = {
        ...linearInput,
        dependencies: [
          { id: 'd1', predecessorId: 'A', successorId: 'B', minGapDays: 7, severity: 'HARD' as const, isDisabled: true },
          { id: 'd2', predecessorId: 'B', successorId: 'C', minGapDays: 7, severity: 'HARD' as const, isDisabled: false },
        ],
      };
      const result = suggestResolution(input, [
        { eventId: 'A', fromStartAt: new Date('2025-01-01'), toStartAt: new Date('2025-01-15'), reason: 'moved A' },
      ]);
      // d1 disabled: B not pushed by A. d2 active: C might be pushed by B (B hasn't moved though)
      expect(result).not.toBeNull();
      expect(result!.find(s => s.eventId === 'B')).toBeUndefined();
    });
  });
});
