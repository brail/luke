/**
 * The catalog fields of a phase (#158): a description that is text or null, never an empty string;
 * a duration in whole calendar days within bounds; a colour from the fixed palette only.
 */

import { describe, expect, it } from 'vitest';

import { PHASE_DURATION_DAYS_MAX, PhaseInputSchema } from '../phase.js';

const base = { value: 'DESIGN', label: 'Design' };

describe('phase catalog fields', () => {
  it('leaves the three fields optional and clearable', () => {
    expect(PhaseInputSchema.parse(base)).toEqual(base);
    expect(PhaseInputSchema.parse({ ...base, description: null, durationDays: null, color: null }))
      .toMatchObject({ description: null, durationDays: null, color: null });
  });

  it('trims a description and refuses one left blank', () => {
    expect(PhaseInputSchema.parse({ ...base, description: '  Bozzetti e moodboard ' }).description).toBe('Bozzetti e moodboard');
    expect(PhaseInputSchema.safeParse({ ...base, description: '   ' }).success).toBe(false);
    expect(PhaseInputSchema.safeParse({ ...base, description: 'x'.repeat(501) }).success).toBe(false);
  });

  it.each([0, -3, 1.5, PHASE_DURATION_DAYS_MAX + 1])('refuses a duration of %s days', durationDays => {
    expect(PhaseInputSchema.safeParse({ ...base, durationDays }).success).toBe(false);
  });

  it('accepts a duration from one day to the maximum', () => {
    expect(PhaseInputSchema.parse({ ...base, durationDays: 1 }).durationDays).toBe(1);
    expect(PhaseInputSchema.parse({ ...base, durationDays: PHASE_DURATION_DAYS_MAX }).durationDays).toBe(PHASE_DURATION_DAYS_MAX);
  });

  it('accepts a palette colour and refuses anything else', () => {
    expect(PhaseInputSchema.parse({ ...base, color: 'teal' }).color).toBe('teal');
    expect(PhaseInputSchema.safeParse({ ...base, color: '#ff0000' }).success).toBe(false);
    expect(PhaseInputSchema.safeParse({ ...base, color: 'red' }).success).toBe(false);
  });
});
