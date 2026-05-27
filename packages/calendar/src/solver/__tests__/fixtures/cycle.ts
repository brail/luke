import type { GraphInput } from '../../types.js';

// A → B → C → A (cycle)
export const cycleInput: GraphInput = {
  events: [
    { id: 'A', startAt: new Date('2025-01-01'), endAt: new Date('2025-01-01'), relevantCountries: [], severity: 'NORMAL' },
    { id: 'B', startAt: new Date('2025-01-10'), endAt: new Date('2025-01-10'), relevantCountries: [], severity: 'NORMAL' },
    { id: 'C', startAt: new Date('2025-01-20'), endAt: new Date('2025-01-20'), relevantCountries: [], severity: 'NORMAL' },
  ],
  dependencies: [
    { id: 'd1', predecessorId: 'A', successorId: 'B', severity: 'HARD', isDisabled: false },
    { id: 'd2', predecessorId: 'B', successorId: 'C', severity: 'HARD', isDisabled: false },
    { id: 'd3', predecessorId: 'C', successorId: 'A', severity: 'HARD', isDisabled: false },
  ],
  holidays: [],
};
