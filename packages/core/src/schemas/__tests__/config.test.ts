/**
 * `AppConfigRegistry`'s parsing contract for the values it is actually consulted for.
 *
 * Two things are pinned here, both of them cases where a setting could be stored and not applied.
 *
 * Booleans: AppConfig holds strings, and `z.coerce.boolean()` follows JavaScript truthiness, so
 * `"false"` parses as `true`. A key declared that way can be switched on and never off — the value
 * sits in the database, the admin sees it, and nothing acts on it. Fifteen keys were affected and
 * only the four password ones had any test; the eleven others govern LDAP, S3 TLS, backup
 * scheduling and email verification.
 *
 * The password prefilter: the floor no configuration can go below. Nothing on the server side
 * asserted it, so lowering it turned nothing red outside the web bundle.
 */

import { describe, it, expect } from 'vitest';

import { AppConfigRegistry } from '../config';
import { passwordPrefilterSchema } from '../password';

/** Every boolean key in the registry — the property must hold for all of them, not a sample. */
const BOOLEAN_KEYS = [
  'auth.requireEmailVerification',
  'auth.ldap.enabled',
  'smtp.secure',
  'storage.local.enableProxy',
  'storage.s3.useSSL',
  'storage.derivatives.enabled',
  'integrations.nav.readOnly',
  'integrations.nav.syncEnabled',
  'integrations.google.calendarSync.enabled',
  'backup.schedule.enabled',
  'backup.notifyOnFailure',
  'security.password.requireUppercase',
  'security.password.requireLowercase',
  'security.password.requireDigit',
  'security.password.requireSpecialChar',
] as const;

describe('boolean settings can be switched off', () => {
  for (const key of BOOLEAN_KEYS) {
    it(`${key} reads "false" as false`, () => {
      const schema = AppConfigRegistry[key];
      expect(schema.parse('false')).toBe(false);
      expect(schema.parse('true')).toBe(true);
    });
  }

  it('refuses a value that is neither, instead of guessing', () => {
    // `"1"`, `"yes"` and `""` used to coerce, three of them to `true`. Refusing surfaces a
    // malformed row through the caller's fallback rather than silently enabling a control.
    const schema = AppConfigRegistry['auth.ldap.enabled'];
    for (const raw of ['1', '0', 'yes', 'TRUE', '']) {
      expect(schema.safeParse(raw).success).toBe(false);
    }
  });
});

describe('the password prefilter is the floor', () => {
  it('refuses fewer than 8 characters', () => {
    expect(passwordPrefilterSchema.safeParse('Ab1!efg').success).toBe(false);
  });

  it('accepts exactly 8 and exactly 128', () => {
    expect(passwordPrefilterSchema.safeParse('Ab1!efgh').success).toBe(true);
    expect(passwordPrefilterSchema.safeParse('x'.repeat(128)).success).toBe(true);
  });

  it('refuses more than 128, which is what bounds the input reaching argon2', () => {
    expect(passwordPrefilterSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });

  it('carries no complexity rule: that is the policy’s job', () => {
    // Deliberate. A schema compiled into the bundle cannot know what an installation configured,
    // and duplicating the rules here is how the copies drifted in the first place.
    expect(passwordPrefilterSchema.safeParse('abcdefgh').success).toBe(true);
  });
});

describe('the registry declares one floor for minLength', () => {
  it('refuses anything below 8 and above 128', () => {
    const schema = AppConfigRegistry['security.password.minLength'];
    expect(schema.safeParse('7').success).toBe(false);
    expect(schema.safeParse('129').success).toBe(false);
    expect(schema.safeParse('8').success).toBe(true);
  });
});
