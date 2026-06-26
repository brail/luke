import type { GraphInput } from '../../types.js';

// A → C, B → C (join / diamond base). A and B are independent.
export const joinInput: GraphInput = {
  events: [
    { id: 'A', startAt: new Date('2025-01-01'), endAt: new Date('2025-01-01'), relevantCountries: [], severity: 'NORMAL' },
    { id: 'B', startAt: new Date('2025-01-05'), endAt: new Date('2025-01-05'), relevantCountries: [], severity: 'NORMAL' },
    { id: 'C', startAt: new Date('2025-01-15'), endAt: new Date('2025-01-15'), relevantCountries: [], severity: 'NORMAL' },
  ],
  dependencies: [
    { id: 'd1', predecessorId: 'A', successorId: 'C', minGapDays: 10, severity: 'HARD', isDisabled: false },
    { id: 'd2', predecessorId: 'B', successorId: 'C', minGapDays: 10, severity: 'HARD', isDisabled: false },
  ],
  holidays: [],
};
