/**
 * One declaration of what a key falls back to when AppConfig has no row for it.
 *
 * The defaults used to be written out at every call site, and the copies had drifted. The clearest
 * case: `storage.s3.endpoint` fell back to `seaweedfs` in `prisma/seed.ts` and in the settings
 * router, but to `localhost` in `storage/index.ts` — the code that opens the connection. On an
 * install that had not been seeded, the settings page showed one host and the system used another,
 * and nothing said so.
 *
 * `APP_CONFIG_DEFAULTS` is now the only place a fallback is written, and `getConfigOrDefault`
 * the only way one is applied. What is pinned here is the user-visible half: with no rows stored,
 * the settings page reports exactly the declared defaults — which is also exactly what the
 * provider will use, because it reads the same declaration.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { APP_CONFIG_DEFAULTS } from '@luke/core';

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
});
