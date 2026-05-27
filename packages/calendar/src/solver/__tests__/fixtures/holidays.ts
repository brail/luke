import type { GraphInput } from '../../types.js';

// Event overlaps Italian holiday (Easter 2025 = 2025-04-20)
export const holidayOverlapInput: GraphInput = {
  events: [
    {
      id: 'A',
      startAt: new Date('2025-04-18'),
      endAt: new Date('2025-04-22'),
      relevantCountries: ['IT'],
      severity: 'NORMAL',
    },
    {
      id: 'B',
      startAt: new Date('2025-05-01'),
      endAt: new Date('2025-05-05'),
      relevantCountries: ['CN'],
      severity: 'NORMAL',
    },
  ],
  dependencies: [],
  holidays: [
    { countryCode: 'IT', startDate: new Date('2025-04-20'), endDate: new Date('2025-04-21') },
    { countryCode: 'CN', startDate: new Date('2025-05-01'), endDate: new Date('2025-05-05') },
  ],
};

// Event with no relevant countries — no holiday violations even if holiday overlaps
export const noCountryInput: GraphInput = {
  events: [
    {
      id: 'A',
      startAt: new Date('2025-04-18'),
      endAt: new Date('2025-04-22'),
      relevantCountries: [],
      severity: 'NORMAL',
    },
  ],
  dependencies: [],
  holidays: [
    { countryCode: 'IT', startDate: new Date('2025-04-20'), endDate: new Date('2025-04-21') },
  ],
};
