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

import { APP_CONFIG_DEFAULTS, AppConfigRegistry, isAppConfigKey, validateConfigValue } from '../config';
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

describe('the registry is consulted on the write path, not only on the read path', () => {
  it('narrows a key that exists and rejects one that does not', () => {
    expect(isAppConfigKey('security.password.minLength')).toBe(true);
    expect(isAppConfigKey('app.test')).toBe(false);
    // A prefix that is registered does not make its children registered.
    expect(isAppConfigKey('security.password')).toBe(false);
  });

  it('does not mistake inherited Object properties for registered keys', () => {
    // `key in registry` would answer true for every one of these, and `saveConfig` would then
    // hand `AppConfigRegistry['toString']` to `safeParse`.
    expect(isAppConfigKey('toString')).toBe(false);
    expect(isAppConfigKey('constructor')).toBe(false);
    expect(isAppConfigKey('__proto__')).toBe(false);
  });

  it('rejects a value its key’s schema refuses', () => {
    const result = validateConfigValue('security.password.minLength', '4');
    expect(result.success).toBe(false);
  });

  it('accepts the string form the value arrives in, not the parsed form', () => {
    // Everything reaching AppConfig is a string; a schema that only accepted `8` would reject
    // every real write.
    expect(validateConfigValue('security.password.minLength', '12').success).toBe(true);
    expect(validateConfigValue('storage.s3.useSSL', 'false').success).toBe(true);
    expect(validateConfigValue('app.sections.disabled', '["pricing"]').success).toBe(true);
  });

  it('refuses the empty string for keys whose absence means "not configured"', () => {
    // These four used to be written as `''` to mean unset, which no schema here can describe.
    // The write paths delete the key instead — see `integrations.google.router.ts`.
    expect(validateConfigValue('integrations.google.oauth.userEmail', '').success).toBe(false);
    expect(validateConfigValue('integrations.google.oauth.refreshToken', '').success).toBe(false);
    expect(validateConfigValue('integrations.google.impersonateEmail', '').success).toBe(false);
    expect(validateConfigValue('storage.s3.publicBaseUrl', '').success).toBe(false);
  });

  it('covers the two keys assembled from a variable', () => {
    // `storage.${provider}` is the only interpolated key in the codebase. Registered, so the JSON
    // blob it writes is validated like every other value instead of being exempt by construction.
    for (const provider of ['smb', 'drive'] as const) {
      expect(isAppConfigKey(`storage.${provider}`)).toBe(true);
    }
    expect(
      validateConfigValue('storage.smb', JSON.stringify({ host: 'nas', path: '/share' })).success,
    ).toBe(true);
    expect(validateConfigValue('storage.smb', JSON.stringify({ host: '' })).success).toBe(false);
  });
});

describe('every registry entry composes safely under safeParse', () => {
  // The property, over the whole registry rather than a sample. Nine entries were written
  // `z.string().transform(s => Schema.parse(JSON.parse(s)))`, where a throw inside the transform
  // propagates through `safeParse` instead of landing in `result.error` — so `safeParse` returning
  // a verdict was true for the scalar keys and a lie for the JSON ones. `jsonConfigSchema` is what
  // makes it uniform, and this is what catches the tenth JSON key added the obvious way.
  const GARBAGE = ['{not json', '', 'null', '[]', '{}', 'true', '-1', 'x'.repeat(300)];

  it.each(Object.keys(AppConfigRegistry))('%s never throws out of safeParse', key => {
    const schema = AppConfigRegistry[key as keyof typeof AppConfigRegistry];
    for (const raw of GARBAGE) {
      expect(() => schema.safeParse(raw)).not.toThrow();
    }
  });

  it('reports a malformed JSON blob as an issue, not an exception', () => {
    const result = AppConfigRegistry['rateLimit'].safeParse('{not json');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toContain('JSON');
  });
});

describe('every declared default is a value its own key would accept', () => {
  // The binding that keeps `APP_CONFIG_DEFAULTS` honest. Its keys are checked by `satisfies`, but
  // nothing in the type system says `'8333'` is a valid port or that `'true'` is how this registry
  // spells a boolean — and a default that its own schema rejects is invisible until a fresh
  // install reads it, which is the one moment nobody is watching.
  it.each(Object.entries(APP_CONFIG_DEFAULTS))('%s = %s', (key, raw) => {
    const result = validateConfigValue(key as keyof typeof AppConfigRegistry, raw);
    expect(result.success ? null : result.message).toBeNull();
  });
});
