/**
 * `User.timezone` is the zone the server renders a person's dates in, so both write paths accept
 * only an IANA name. Anything else used to be stored as typed, and every server-side reader would
 * have had to guess.
 */

import { describe, it, expect } from 'vitest';

import { UpdateTimezoneSchema, UserProfileSchema } from '../userProfile.js';

const PROFILE = { firstName: 'Mario', lastName: 'Rossi', locale: 'it-IT' };

describe('User.timezone on write', () => {
  it.each(['Europe/Rome', 'America/Los_Angeles', 'Asia/Kolkata', 'Asia/Calcutta', 'UTC'])('accepts %s', timezone => {
    expect(UpdateTimezoneSchema.safeParse({ timezone }).success).toBe(true);
    expect(UserProfileSchema.safeParse({ ...PROFILE, timezone }).success).toBe(true);
  });

  it.each(['', 'Mars/Olympus', '+01:00', '−01:00', 'Europe/Rome '.repeat(6)])('refuses %j', timezone => {
    expect(UpdateTimezoneSchema.safeParse({ timezone }).success).toBe(false);
    expect(UserProfileSchema.safeParse({ ...PROFILE, timezone }).success).toBe(false);
  });

  it('stores a zone typed in another case the way Intl spells it', () => {
    expect(UpdateTimezoneSchema.parse({ timezone: 'europe/rome' }).timezone).toBe('Europe/Rome');
    expect(UserProfileSchema.parse({ ...PROFILE, timezone: 'utc' }).timezone).toBe('UTC');
  });

  it('names the problem', () => {
    const result = UpdateTimezoneSchema.safeParse({ timezone: 'Mars/Olympus' });
    expect(result.error?.issues[0]?.message).toBe('Fuso orario non valido');
  });
});
