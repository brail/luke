import type { GraphInput } from '../../types.js';

// A → B → C, each with minGapDays=7 (HARD)
export const linearInput: GraphInput = {
  events: [
    { id: 'A', startAt: new Date('2025-01-01'), endAt: new Date('2025-01-01'), relevantCountries: [], severity: 'NORMAL' },
    { id: 'B', startAt: new Date('2025-01-10'), endAt: new Date('2025-01-10'), relevantCountries: [], severity: 'NORMAL' },
    { id: 'C', startAt: new Date('2025-01-20'), endAt: new Date('2025-01-20'), relevantCountries: [], severity: 'NORMAL' },
  ],
  dependencies: [
    { id: 'd1', predecessorId: 'A', successorId: 'B', minGapDays: 7, severity: 'HARD', isDisabled: false },
    { id: 'd2', predecessorId: 'B', successorId: 'C', minGapDays: 7, severity: 'HARD', isDisabled: false },
  ],
  holidays: [],
};
