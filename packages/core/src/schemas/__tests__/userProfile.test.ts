/**
 * `User.timezone` is the zone the server renders a person's dates in, so both write paths accept
 * only an IANA name. Anything else used to be stored as typed, and every server-side reader would
 * have had to guess.
 */

import { describe, it, expect } from 'vitest';

import { RequestPasswordResetSchema, SubmitPendingEmailSchema } from '../auth.js';
import { CreateUserInputSchema, EmailSchema, UpdateUserInputSchema } from '../user.js';
import { ChangeEmailSchema, UpdateTimezoneSchema, UserProfileSchema } from '../userProfile.js';

const PROFILE = { firstName: 'Mario', lastName: 'Rossi', locale: 'it-IT' };

describe('User.timezone on write', () => {
  it.each(['Europe/Rome', 'America/Los_Angeles', 'Asia/Kolkata', 'Asia/Calcutta', 'UTC'])('accepts %s', timezone => {
    expect(UpdateTimezoneSchema.safeParse({ timezone }).success).toBe(true);
    expect(UserProfileSchema.safeParse({ ...PROFILE, timezone }).success).toBe(true);
  });

  // A padded zone is refused, not trimmed: `TimeZoneSchema` accepts only what `isValidTimeZone` does.
  it.each(['', ' Europe/Rome', 'Europe/Rome ', 'Mars/Olympus', '+01:00', '−01:00'])('refuses %j', timezone => {
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

// #228: every writer of `User.email` stores one form, the one the database's CHECK accepts.
describe('EmailSchema', () => {
  it('trims and lowercases', () => {
    expect(EmailSchema.parse('  Mario.Rossi@Example.IT ')).toBe('mario.rossi@example.it');
  });

  it.each(['', '   ', 'not-an-email', 'mario@', 'màrio@example.it', `${'a'.repeat(251)}@x.it`])('refuses %j', value => {
    expect(EmailSchema.safeParse(value).success).toBe(false);
  });

  it('is the form of every user email input', () => {
    const typed = ' Mario@Example.IT';
    expect(CreateUserInputSchema.shape.email.parse(typed)).toBe('mario@example.it');
    expect(UpdateUserInputSchema.shape.email.parse(typed)).toBe('mario@example.it');
    expect(ChangeEmailSchema.shape.newEmail.parse(typed)).toBe('mario@example.it');
    expect(RequestPasswordResetSchema.shape.email.parse(typed)).toBe('mario@example.it');
    expect(SubmitPendingEmailSchema.shape.email.parse(typed)).toBe('mario@example.it');
  });
});
