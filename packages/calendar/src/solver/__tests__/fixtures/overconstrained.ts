import type { GraphInput } from '../../types.js';

// A → B with minGapDays=5 AND maxGapDays=3 (HARD): impossible
export const overconstrainedInput: GraphInput = {
  events: [
    { id: 'A', startAt: new Date('2025-01-01'), endAt: new Date('2025-01-01'), relevantCountries: [], severity: 'NORMAL' },
    { id: 'B', startAt: new Date('2025-01-10'), endAt: new Date('2025-01-10'), relevantCountries: [], severity: 'NORMAL' },
  ],
  dependencies: [
    {
      id: 'd1',
      predecessorId: 'A',
      successorId: 'B',
      minGapDays: 5,
      maxGapDays: 3,
      severity: 'HARD',
      isDisabled: false,
    },
  ],
  holidays: [],
};

// A → B with maxGapDays=2 (HARD): B is already 9 days after A, can't move it closer
export const maxGapViolatedInput: GraphInput = {
  events: [
    { id: 'A', startAt: new Date('2025-01-01'), endAt: new Date('2025-01-01'), relevantCountries: [], severity: 'NORMAL' },
    { id: 'B', startAt: new Date('2025-01-10'), endAt: new Date('2025-01-10'), relevantCountries: [], severity: 'NORMAL' },
  ],
  dependencies: [
    {
      id: 'd1',
      predecessorId: 'A',
      successorId: 'B',
      maxGapDays: 2,
      severity: 'HARD',
      isDisabled: false,
    },
  ],
  holidays: [],
};
