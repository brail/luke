import type { GraphInput } from '../../types.js';

// A → B, A → C (fork). B and C are independent.
export const forkInput: GraphInput = {
  events: [
    { id: 'A', startAt: new Date('2025-01-01'), endAt: new Date('2025-01-01'), relevantCountries: [], severity: 'NORMAL' },
    { id: 'B', startAt: new Date('2025-01-10'), endAt: new Date('2025-01-10'), relevantCountries: [], severity: 'NORMAL' },
    { id: 'C', startAt: new Date('2025-01-10'), endAt: new Date('2025-01-10'), relevantCountries: [], severity: 'NORMAL' },
  ],
  dependencies: [
    { id: 'd1', predecessorId: 'A', successorId: 'B', minGapDays: 5, severity: 'HARD', isDisabled: false },
    { id: 'd2', predecessorId: 'A', successorId: 'C', minGapDays: 5, severity: 'HARD', isDisabled: false },
  ],
  holidays: [],
};
