/**
 * One declaration of what a key falls back to when AppConfig has no row for it.
 *
 * The drift this closed — and why the defaults are not spelled at the call site — is recorded on
 * `APP_CONFIG_DEFAULTS` in `packages/core/src/schemas/config.ts`. What is pinned here is the
 * user-visible half: with no rows stored, the settings page reports exactly the declared defaults,
 * which is also exactly what the provider uses, because it reads the same declaration.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { APP_CONFIG_DEFAULTS } from '@luke/core';

import { loadS3Provider } from '../src/storage';

import { setupTestDb, createCallerAs } from './helpers';

describe('AppConfig defaults', () => {
  let testPrisma: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    testPrisma = await setupTestDb();
    // The unconfigured install: this is the state in which the copies disagreed. With rows
    // present they all read the same stored value and the divergence stays invisible.
    await testPrisma.appConfig.deleteMany({ where: { key: { startsWith: 'storage.' } } });
  });

  it('reports the declared defaults when nothing is stored', async () => {
    const caller = await createCallerAs('admin');
    const config = await caller.storage.getConfig();

    expect(config.type).toBe('local');
    expect(config.local.maxFileSizeMB).toBe(50);
    expect(config.local.enableProxy).toBe(true);

    expect(config.s3.endpoint).toBe(APP_CONFIG_DEFAULTS['storage.s3.endpoint']);
    expect(config.s3.port).toBe(Number(APP_CONFIG_DEFAULTS['storage.s3.port']));
    expect(config.s3.useSSL).toBe(false);
    expect(config.s3.region).toBe(APP_CONFIG_DEFAULTS['storage.s3.region']);
    expect(config.s3.presignedPutTtl).toBe(3600);
    expect(config.s3.presignedGetTtl).toBe(3600);
  });

  it('offers no credential the database does not hold', async () => {
    // The provider has a dev fallback for these two; the settings form must not. Handing an admin
    // `s3admin`/`s3adminpwd` in a form field invites them to save it as though it were configured,
    // which is why the credentials are deliberately absent from `APP_CONFIG_DEFAULTS`.
    const caller = await createCallerAs('admin');
    const config = await caller.storage.getConfig();

    expect(config.s3.accessKey).toBe('');
    expect(config.s3.secretKey).toBe('');
  });

  it('prefers the stored value over the default', async () => {
    const caller = await createCallerAs('admin');
    await caller.config.set({
      key: 'storage.s3.endpoint',
      value: 'minio.internal',
      encrypt: false,
    });

    expect((await caller.storage.getConfig()).s3.endpoint).toBe('minio.internal');
  });

  it('falls back rather than throwing when a stored value no longer validates', async () => {
    // A malformed row is a bad edit, not a reason to take the storage layer down. The value is
    // written straight to the table because `saveConfig` would now refuse it.
    await testPrisma.appConfig.create({
      data: { key: 'storage.s3.port', value: 'not-a-port', isEncrypted: false },
    });

    const caller = await createCallerAs('admin');
    expect((await caller.storage.getConfig()).s3.port).toBe(
      Number(APP_CONFIG_DEFAULTS['storage.s3.port']),
    );
  });

  describe('missing S3 credentials', () => {
    it('refuses to build the provider instead of substituting a known one', async () => {
      // `loadS3Provider` used to fall back to `s3admin`/`s3adminpwd` unconditionally, production
      // included. Seeded installs have both rows, so the fallback only ever fired when S3 was
      // selected and its credentials were gone — connecting with a guessable credential rather
      // than saying so. `getSmtpConfig` refuses an incomplete SMTP config; this now matches.
      await testPrisma.appConfig.deleteMany({
        where: { key: { in: ['storage.s3.accessKey', 'storage.s3.secretKey'] } },
      });

      await expect(loadS3Provider(testPrisma)).rejects.toThrow(/Credenziali S3 non configurate/);
    });
  });
});
