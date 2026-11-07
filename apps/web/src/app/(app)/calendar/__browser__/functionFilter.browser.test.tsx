import { expect, test } from 'vitest';

import { matchesFunctionFilter } from '../utils';

/** The calendar's function chips keep an event with no function visibility, which everyone sees (#199). */

const SHOWN = 'f-shown';
const HIDDEN = 'f-hidden';

test('keeps an event with no function visibility', () => {
  expect(matchesFunctionFilter({ visibilities: [] }, [SHOWN])).toBe(true);
});

test('keeps an event visible to a shown function', () => {
  expect(matchesFunctionFilter({ visibilities: [{ functionId: HIDDEN }, { functionId: SHOWN }] }, [SHOWN])).toBe(true);
});

test('drops an event visible only to hidden functions', () => {
  expect(matchesFunctionFilter({ visibilities: [{ functionId: HIDDEN }] }, [SHOWN])).toBe(false);
});
