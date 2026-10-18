import { describe, it, expect } from 'vitest';

import { WallTimeSchema } from '../dates.js';

describe('WallTimeSchema', () => {
  it.each(['00:00', '07:30', '23:59'])('accepts %s', value => {
    expect(WallTimeSchema.parse(value)).toBe(value);
  });

  it.each(['24:00', '07:30:00'])('refuses %j', value => {
    expect(WallTimeSchema.safeParse(value).error?.issues.map(i => i.message)).toEqual(['Formato orario non valido (HH:mm)']);
  });
});
