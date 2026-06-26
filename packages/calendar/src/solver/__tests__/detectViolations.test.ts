import { describe, it, expect } from 'vitest';

import { detectViolations } from '../detectViolations.js';
import { cycleInput } from './fixtures/cycle.js';
import { forkInput } from './fixtures/fork.js';
import { holidayOverlapInput, noCountryInput } from './fixtures/holidays.js';
import { joinInput } from './fixtures/join.js';
import { linearInput } from './fixtures/linear.js';
import { maxGapViolatedInput } from './fixtures/overconstrained.js';

describe('detectViolations', () => {
  describe('linear chain A→B→C, no shifts', () => {
    it('returns no violations when gaps satisfied', () => {
      const result = detectViolations(linearInput, []);
      expect(result).toHaveLength(0);
    });

    it('GAP_MIN HARD when B too close to A', () => {
      const result = detectViolations(linearInput, [
        { eventId: 'B', fromStartAt: new Date('2025-01-10'), toStartAt: new Date('2025-01-05'), reason: 'test' },
      ]);
      const gapViol = result.filter(v => v.type === 'GAP_MIN');
      expect(gapViol).toHaveLength(1);
      expect(gapViol[0]!.severity).toBe('HARD');
      expect(gapViol[0]!.eventIds).toContain('B');
    });

    it('no violation for disabled dependency', () => {
      const inputWithDisabled = {
        ...linearInput,
        dependencies: linearInput.dependencies.map(d =>
          d.id === 'd1' ? { ...d, isDisabled: true } : d,
        ),
      };
      const result = detectViolations(inputWithDisabled, [
        { eventId: 'B', fromStartAt: new Date('2025-01-10'), toStartAt: new Date('2025-01-02'), reason: 'test' },
      ]);
      const gapViol = result.filter(v => v.type === 'GAP_MIN' && v.eventIds.includes('B'));
      expect(gapViol).toHaveLength(0);
    });
  });

  describe('fork A→B, A→C', () => {
    it('no violations when both satisfied', () => {
      expect(detectViolations(forkInput, [])).toHaveLength(0);
    });

    it('GAP_MIN for one branch only', () => {
      const result = detectViolations(forkInput, [
        { eventId: 'B', fromStartAt: new Date('2025-01-10'), toStartAt: new Date('2025-01-03'), reason: 'test' },
      ]);
      const gapViol = result.filter(v => v.type === 'GAP_MIN');
      expect(gapViol).toHaveLength(1);
      expect(gapViol[0]!.eventIds).toContain('B');
    });
  });

  describe('join A→C, B→C', () => {
    it('no violations when C satisfies both predecessors', () => {
      expect(detectViolations(joinInput, [])).toHaveLength(0);
    });
  });

  describe('cycle detection', () => {
    it('returns CYCLE_DETECTED and stops', () => {
      const result = detectViolations(cycleInput, []);
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('CYCLE_DETECTED');
      expect(result[0]!.severity).toBe('HARD');
    });
  });

  describe('maxGapDays', () => {
    it('GAP_MAX HARD when successor too far from predecessor', () => {
      const result = detectViolations(maxGapViolatedInput, []);
      const gapViol = result.filter(v => v.type === 'GAP_MAX');
      expect(gapViol).toHaveLength(1);
      expect(gapViol[0]!.severity).toBe('HARD');
    });
  });

  describe('holiday overlaps', () => {
    it('HOLIDAY_OVERLAP SOFT for relevant country', () => {
      const result = detectViolations(holidayOverlapInput, []);
      const holViol = result.filter(v => v.type === 'HOLIDAY_OVERLAP');
      expect(holViol.length).toBeGreaterThanOrEqual(2); // A overlaps IT, B overlaps CN
      expect(holViol.every(v => v.severity === 'SOFT')).toBe(true);
    });

    it('no HOLIDAY_OVERLAP when no relevant countries', () => {
      const result = detectViolations(noCountryInput, []);
      expect(result.filter(v => v.type === 'HOLIDAY_OVERLAP')).toHaveLength(0);
    });

    it('no HOLIDAY_OVERLAP when country not matching', () => {
      const result = detectViolations(holidayOverlapInput, []);
      const forA = result.filter(v => v.type === 'HOLIDAY_OVERLAP' && v.eventIds.includes('A'));
      expect(forA.every(v => v.details.includes('IT'))).toBe(true);
    });
  });

  describe('SOFT dependency violations', () => {
    it('GAP_MIN SOFT does not block, still reported', () => {
      const softInput = {
        ...linearInput,
        dependencies: [
          { id: 'd1', predecessorId: 'A', successorId: 'B', minGapDays: 7, severity: 'SOFT' as const, isDisabled: false },
        ],
      };
      const result = detectViolations(softInput, [
        { eventId: 'B', fromStartAt: new Date('2025-01-10'), toStartAt: new Date('2025-01-03'), reason: 'test' },
      ]);
      const gapViol = result.filter(v => v.type === 'GAP_MIN');
      expect(gapViol).toHaveLength(1);
      expect(gapViol[0]!.severity).toBe('SOFT');
    });
  });
});
