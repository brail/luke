/**
 * The write path answers to `AppConfigRegistry`.
 *
 * `getTypedConfig` has always parsed reads through the registry schema; writes went through
 * `saveConfig(key: string, value: string)` and consulted nothing. So the registry described what
 * the application expected to find rather than what it was allowed to store, and the only write
 * validation in the codebase was a hand-written `if (key === 'security.password.minLength')` —
 * the general rule, approximated for the one key someone had needed it for.
 *
 * What is pinned here is the runtime half. The compile-time half — a key outside the registry, or
 * a value whose type no longer matches, failing `tsc` at the call site that writes it — is covered
 * by `configWriteAuthority.types.spec.ts`, because a type error cannot be asserted at runtime.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { getConfig } from '../src/lib/configManager';

import { setupTestDb, createCallerAs, expectToThrow } from './helpers';

describe('AppConfig write authority', () => {
  let testPrisma: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    testPrisma = await setupTestDb();
  });

  describe('the key must be registered', () => {
    it('refuses a well-formed key that no registry entry declares', async () => {
      const caller = await createCallerAs('admin');

      // Correct dot-notation, allowed prefix, and until now a successful write: the prefix
      // allowlist was the only gate, so any `app.*` string created a row nothing could ever read.
      await expectToThrow(
        caller.config.set({ key: 'app.whatever', value: 'x', encrypt: false }),
        { code: 'BAD_REQUEST' },
      );

      expect(await testPrisma.appConfig.findUnique({ where: { key: 'app.whatever' } })).toBeNull();
    });

    it('still refuses a registered key the prefix allowlist keeps off the generic endpoint', async () => {
      const caller = await createCallerAs('admin');

      // `backup.retentionDays` is in the registry, written by its own router. Registry membership
      // is not a licence for `config.set` to reach it — the two gates are independent, and leaning
      // on the registry alone would have opened every `backup.*`, `rbac.*` and `rateLimit` key.
      await expectToThrow(
        caller.config.set({ key: 'backup.retentionDays', value: '30', encrypt: false }),
        { code: 'BAD_REQUEST' },
      );
    });
  });

  describe('the value must satisfy the key’s schema', () => {
    it('refuses a value below the floor the registry declares', async () => {
      const caller = await createCallerAs('admin');

      await expectToThrow(
        caller.config.set({ key: 'security.password.minLength', value: '4', encrypt: false }),
        { code: 'BAD_REQUEST' },
      );

      expect(
        await testPrisma.appConfig.findUnique({ where: { key: 'security.password.minLength' } }),
      ).toBeNull();
    });

    it('refuses the four password toggles set to something that is not a boolean', async () => {
      const caller = await createCallerAs('admin');

      // These four are what makes the password policy authoritative. A value the schema cannot
      // read is not a policy anyone chose — before, it was stored and then silently ignored.
      await expectToThrow(
        caller.config.set({
          key: 'security.password.requireDigit',
          value: 'nope',
          encrypt: false,
        }),
        { code: 'BAD_REQUEST' },
      );
    });

    it('refuses a malformed JSON blob instead of letting it surface as a 500 on first read', async () => {
      const caller = await createCallerAs('admin');

      // JSON-blob keys go through `jsonConfigSchema`, which reports a bad parse via `ctx.addIssue`
      // rather than throwing out of `safeParse`. Written the obvious way — `.transform(s =>
      // Schema.parse(JSON.parse(s)))` — this would leave as a `SyntaxError` 500, not a BAD_REQUEST.
      await expectToThrow(
        caller.config.set({ key: 'app.sections.disabled', value: '{not json', encrypt: false }),
        { code: 'BAD_REQUEST' },
      );
    });

    it('validates the plaintext, not the ciphertext', async () => {
      const caller = await createCallerAs('admin');

      // `saveConfig` encrypts after validating. Validating after would test a hex blob against a
      // rule written for the secret — `min(1)` would pass for every value, valid or not.
      await expectToThrow(
        caller.config.set({ key: 'auth.ldap.url', value: 'not-a-url', encrypt: true }),
        { code: 'BAD_REQUEST' },
      );

      await caller.config.set({
        key: 'auth.ldap.url',
        value: 'ldaps://dc.example.com',
        encrypt: true,
      });
      expect(await getConfig(testPrisma, 'auth.ldap.url', true)).toBe('ldaps://dc.example.com');
    });
  });

  describe('importJson', () => {
    it('skips the invalid entry, imports the rest, and names what it skipped', async () => {
      const caller = await createCallerAs('admin');

      // The restore path. It already wrapped each item in its own try/catch and reported through
      // `errorCount`/`errors[]`, so a throwing `saveConfig` gives "skip and report" with no new
      // code and no change to the contract — a backup carrying one stale value still restores.
      const result = await caller.config.importJson({
        items: [
          { key: 'app.name', value: 'Luke', encrypt: false },
          { key: 'security.password.minLength', value: '4', encrypt: false },
          { key: 'app.locale', value: 'it', encrypt: false },
        ],
      });

      expect(result.successCount).toBe(2);
      expect(result.errorCount).toBe(1);
      expect(result.errors[0].key).toBe('security.password.minLength');

      expect((await testPrisma.appConfig.findUnique({ where: { key: 'app.name' } }))?.value).toBe(
        'Luke',
      );
      expect(
        await testPrisma.appConfig.findUnique({ where: { key: 'security.password.minLength' } }),
      ).toBeNull();
    });
  });

  describe('absence is the absence of the key', () => {
    it('removes the row rather than writing an empty string for it', async () => {
      const caller = await createCallerAs('admin');
      const s3Config = {
        type: 's3',
        endpoint: 'minio.example.com',
        port: 9000,
        useSSL: true,
        accessKey: 'ak',
        secretKey: 'sk',
        region: 'us-east-1',
        presignedPutTtl: 3600,
        presignedGetTtl: 3600,
      } as const;

      await caller.storage.saveConfig({ ...s3Config, publicBaseUrl: 'https://cdn.example.com' });
      expect(
        (await testPrisma.appConfig.findUnique({ where: { key: 'storage.s3.publicBaseUrl' } }))
          ?.value,
      ).toBe('https://cdn.example.com');

      // Clearing the field means "derive the URL from the endpoint", which every reader spells as
      // a falsy check. Writing `''` would have been a second way to say what `null` already says,
      // and one `z.string().url()` cannot describe.
      await caller.storage.saveConfig({ ...s3Config, publicBaseUrl: '' });
      expect(
        await testPrisma.appConfig.findUnique({ where: { key: 'storage.s3.publicBaseUrl' } }),
      ).toBeNull();
    });
  });
});
