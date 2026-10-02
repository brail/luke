/**
 * A settings form is saved as one change: every key it writes or removes goes through one
 * `saveConfigs` call, validated before anything is written and committed in one transaction.
 *
 * Failures are injected inside the database, by a trigger that raises only for a value this test
 * generated, created before the call and dropped in `finally`: no other write can match it. Each
 * rejection case seeds rows that differ from what it sends, so "unchanged" cannot hide a write.
 */

import { randomUUID } from 'crypto';

import { Client } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as calendar from '@luke/calendar';
import type { AppConfigKey } from '@luke/core';
import { getRbacConfig } from '@luke/core/server';
import type { PrismaClient } from '@luke/db';
import * as nav from '@luke/nav';

import * as configManager from '../src/lib/configManager';
import { getConfig, saveConfig } from '../src/lib/configManager';
import * as navScheduler from '../src/lib/navSyncScheduler';

import { createCallerAs, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Makes the database refuse the write of `key` with `value`, and only that one: the value is a
 * fresh UUID, so no other write can match. Returns the cleanup, to call in `finally`.
 */
async function refuseWrite(key: string, value: string): Promise<() => Promise<void>> {
  const name = `r3_refuse_${randomUUID().replace(/-/g, '')}`;
  const client = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await client.connect();
  // Identifiers and literals are generated here (a UUID and a registry key), never user input.
  await client.query(`
    CREATE FUNCTION ${name}() RETURNS trigger AS $body$
    BEGIN
      IF NEW.key = '${key}' AND NEW.value = '${value}' THEN
        RAISE EXCEPTION 'injected failure for %', NEW.key;
      END IF;
      RETURN NEW;
    END
    $body$ LANGUAGE plpgsql;
    CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON app_configs
      FOR EACH ROW EXECUTE FUNCTION ${name}();
  `);
  return async () => {
    try {
      await client.query(`DROP TRIGGER IF EXISTS ${name} ON app_configs; DROP FUNCTION IF EXISTS ${name}();`);
    } finally {
      await client.end();
    }
  };
}

/** The stored rows of `keys`, ciphertext included. */
async function rowsOf(keys: AppConfigKey[]) {
  return prisma.appConfig.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true, isEncrypted: true },
    orderBy: { key: 'asc' },
  });
}

describe('a failing write leaves the whole form as it was', () => {
  it('mail', async () => {
    const keys: AppConfigKey[] = ['smtp.host', 'smtp.port', 'smtp.secure', 'smtp.user', 'smtp.pass', 'smtp.from', 'app.baseUrl'];
    await saveConfig(prisma, 'smtp.host', 'old-smtp.example.com');
    await saveConfig(prisma, 'smtp.port', '25');
    await saveConfig(prisma, 'smtp.secure', 'true');
    await saveConfig(prisma, 'smtp.user', 'old-user');
    await saveConfig(prisma, 'smtp.pass', 'old-pass', true);
    await saveConfig(prisma, 'smtp.from', 'old@example.com');
    await saveConfig(prisma, 'app.baseUrl', 'https://old.example.com');
    const before = await rowsOf(keys);

    const user = randomUUID();
    const restore = await refuseWrite('smtp.user', user);
    try {
      const caller = await createCallerAs('admin');
      await expect(
        caller.integrations.mail.saveConfig({
          host: 'new-smtp.example.com',
          port: 587,
          secure: false,
          user,
          pass: 'new-pass',
          from: 'Luke <noreply@example.com>',
          baseUrl: 'https://luke.example.com',
        })
      ).rejects.toThrow();
    } finally {
      await restore();
    }

    expect(await rowsOf(keys)).toEqual(before);
  });

  it('NAV, and the pool is not closed', async () => {
    const keys: AppConfigKey[] = [
      'integrations.nav.host', 'integrations.nav.port', 'integrations.nav.database', 'integrations.nav.user',
      'integrations.nav.company', 'integrations.nav.readOnly', 'integrations.nav.syncEnabled',
    ];
    await saveConfig(prisma, 'integrations.nav.host', 'old-host');
    await saveConfig(prisma, 'integrations.nav.port', '1433');
    await saveConfig(prisma, 'integrations.nav.database', 'OLD');
    await saveConfig(prisma, 'integrations.nav.user', 'old-user');
    await saveConfig(prisma, 'integrations.nav.company', 'OLD CO');
    await saveConfig(prisma, 'integrations.nav.readOnly', 'true');
    await saveConfig(prisma, 'integrations.nav.syncEnabled', 'false');
    const before = await rowsOf(keys);
    const closePool = vi.spyOn(nav, 'closePool').mockResolvedValue(undefined);

    const user = randomUUID();
    const restore = await refuseWrite('integrations.nav.user', user);
    try {
      const caller = await createCallerAs('admin');
      await expect(
        caller.integrations.nav.saveConfig({
          host: 'new-host', port: 1434, database: 'NEW', user, company: 'NEW CO',
          readOnly: false, syncEnabled: true,
        })
      ).rejects.toThrow();
    } finally {
      await restore();
    }

    expect(await rowsOf(keys)).toEqual(before);
    expect(closePool).not.toHaveBeenCalled();
  });
});

describe('NAV closes the old pool only once the new configuration is committed', () => {
  it('closes it after a successful save, seeing the new values', async () => {
    await saveConfig(prisma, 'integrations.nav.host', 'old-host');
    let hostAtClose: string | null = null;
    const closePool = vi.spyOn(nav, 'closePool').mockImplementation(async () => {
      hostAtClose = await getConfig(prisma, 'integrations.nav.host', false);
    });

    const caller = await createCallerAs('admin');
    await caller.integrations.nav.saveConfig({
      host: 'new-host', port: 1434, database: 'NEW', user: 'new-user', company: 'NEW CO',
      readOnly: false, syncEnabled: true,
    });

    expect(closePool).toHaveBeenCalledOnce();
    expect(hostAtClose).toBe('new-host');
  });

  it('runs the whole save through the NAV configuration queue', async () => {
    vi.spyOn(nav, 'closePool').mockResolvedValue(undefined);
    const getConfigSpy = vi.spyOn(configManager, 'getConfig');
    const pause = vi.spyOn(navScheduler, 'pauseNavScheduler');
    let held: (() => Promise<unknown>) | undefined;
    vi.spyOn(navScheduler.navConfigChanges, 'run').mockImplementation(op => {
      held = op;
      return new Promise(() => undefined);
    });

    const caller = await createCallerAs('admin');
    void caller.integrations.nav.saveConfig({
      host: 'h', port: 1433, database: 'D', user: 'u', company: 'C', readOnly: false, syncEnabled: true,
    });
    await vi.waitFor(() => expect(held).toBeDefined());

    // Nothing of the save has started outside the queued operation.
    expect(getConfigSpy).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    await held!();
    expect(getConfigSpy).toHaveBeenCalled();
  });
});

describe('every form writes through exactly one saveConfigs call', () => {
  /** The one batch a procedure sent, as `[key, 'plain' | 'encrypted' | 'delete']`, sorted. */
  function spyBatches() {
    const batches = vi.spyOn(configManager, 'saveConfigs');
    const single = vi.spyOn(configManager, 'saveConfig');
    const remove = vi.spyOn(configManager, 'deleteConfig');
    return () => {
      expect(single).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(batches).toHaveBeenCalledOnce();
      const writes = batches.mock.calls[0]![1];
      return writes
        .map(w => [w.key, w.value === null ? 'delete' : w.encrypt ? 'encrypted' : 'plain'] as const)
        .sort(([a], [b]) => a.localeCompare(b));
    };
  }

  it('mail, with and without a new password', async () => {
    const caller = await createCallerAs('admin');
    const base = { host: 'smtp.example.com', port: 587, secure: false, user: 'u', from: 'a@example.com', baseUrl: 'https://luke.example.com' };
    const plain: Array<[string, string]> = [
      ['app.baseUrl', 'plain'], ['smtp.from', 'plain'], ['smtp.host', 'plain'], ['smtp.port', 'plain'],
      ['smtp.secure', 'plain'], ['smtp.user', 'plain'],
    ];

    let batch = spyBatches();
    await caller.integrations.mail.saveConfig({ ...base, pass: 'secret' });
    expect(batch()).toEqual([...plain, ['smtp.pass', 'encrypted']].sort(([a], [b]) => a.localeCompare(b)));
    vi.restoreAllMocks();

    batch = spyBatches();
    await caller.integrations.mail.saveConfig({ ...base, pass: '' });
    expect(batch()).toEqual(plain);
  });

  it('storage, local and S3 (a blank public URL removes the key)', async () => {
    vi.spyOn(await import('../src/storage'), 'resetStorageProvider').mockImplementation(() => undefined);
    const caller = await createCallerAs('admin');

    let batch = spyBatches();
    await caller.storage.saveConfig({ type: 'local', basePath: '/tmp/luke-r3', maxFileSizeMB: 10, enableProxy: true });
    expect(batch()).toEqual([
      ['storage.local.basePath', 'plain'], ['storage.local.enableProxy', 'plain'],
      ['storage.local.maxFileSizeMB', 'plain'], ['storage.type', 'plain'],
    ]);
    vi.restoreAllMocks();
    vi.spyOn(await import('../src/storage'), 'resetStorageProvider').mockImplementation(() => undefined);

    batch = spyBatches();
    await caller.storage.saveConfig({
      type: 's3', endpoint: 's3.example.com', port: 9000, useSSL: true, accessKey: 'ak', secretKey: 'sk',
      region: 'eu', publicBaseUrl: '', presignedPutTtl: 300, presignedGetTtl: 300,
    });
    expect(batch()).toEqual([
      ['storage.s3.accessKey', 'encrypted'], ['storage.s3.endpoint', 'plain'], ['storage.s3.port', 'plain'],
      ['storage.s3.presignedGetTtl', 'plain'], ['storage.s3.presignedPutTtl', 'plain'],
      ['storage.s3.publicBaseUrl', 'delete'], ['storage.s3.region', 'plain'],
      ['storage.s3.secretKey', 'encrypted'], ['storage.s3.useSSL', 'plain'], ['storage.type', 'plain'],
    ]);
  });

  it('Google, service account and OAuth (blank secrets kept, no impersonation removed)', async () => {
    const caller = await createCallerAs('admin');

    let batch = spyBatches();
    await caller.integrations.google.saveConfig({
      authMode: 'service_account', serviceEmail: 'svc@example.com', serviceKey: '', impersonateEmail: '',
      domain: 'example.com', calendarSyncEnabled: true,
    });
    expect(batch()).toEqual([
      ['integrations.google.authMode', 'plain'], ['integrations.google.calendarSync.enabled', 'plain'],
      ['integrations.google.domain', 'plain'], ['integrations.google.impersonateEmail', 'delete'],
      ['integrations.google.serviceEmail', 'plain'],
    ]);
    vi.restoreAllMocks();

    batch = spyBatches();
    await caller.integrations.google.saveConfig({
      authMode: 'oauth_user', oauthClientId: 'client', oauthClientSecret: 'shh', domain: 'example.com',
      calendarSyncEnabled: false,
    });
    expect(batch()).toEqual([
      ['integrations.google.authMode', 'plain'], ['integrations.google.calendarSync.enabled', 'plain'],
      ['integrations.google.domain', 'plain'], ['integrations.google.oauth.clientId', 'plain'],
      ['integrations.google.oauth.clientSecret', 'encrypted'],
    ]);
  });

  it('Google OAuth connect and disconnect', async () => {
    await saveConfig(prisma, 'integrations.google.oauth.clientId', 'client');
    await saveConfig(prisma, 'integrations.google.oauth.clientSecret', 'shh', true);
    vi.spyOn(calendar, 'exchangeOAuthCode').mockResolvedValue({ refreshToken: 'token', userEmail: null });
    const caller = await createCallerAs('admin');

    let batch = spyBatches();
    await caller.integrations.google.exchangeOAuthCode({ code: 'c', redirectUri: 'https://luke.example.com/cb' });
    expect(batch()).toEqual([
      ['integrations.google.oauth.refreshToken', 'encrypted'], ['integrations.google.oauth.userEmail', 'delete'],
    ]);
    vi.restoreAllMocks();

    batch = spyBatches();
    await caller.integrations.google.disconnectOAuth();
    expect(batch()).toEqual([
      ['integrations.google.oauth.refreshToken', 'delete'], ['integrations.google.oauth.userEmail', 'delete'],
    ]);
  });

  it('NAV, with and without a new password', async () => {
    vi.spyOn(nav, 'closePool').mockResolvedValue(undefined);
    const caller = await createCallerAs('admin');
    const base = { host: 'h', port: 1433, database: 'D', user: 'u', company: 'C', readOnly: true, syncEnabled: false };
    const plain: Array<[string, string]> = [
      ['integrations.nav.company', 'plain'], ['integrations.nav.database', 'plain'], ['integrations.nav.host', 'plain'],
      ['integrations.nav.port', 'plain'], ['integrations.nav.readOnly', 'plain'], ['integrations.nav.syncEnabled', 'plain'],
      ['integrations.nav.user', 'plain'],
    ];

    let batch = spyBatches();
    await caller.integrations.nav.saveConfig({ ...base, password: 'pw' });
    expect(batch()).toEqual([...plain, ['integrations.nav.password', 'encrypted']].sort(([a], [b]) => a.localeCompare(b)));
    vi.restoreAllMocks();
    vi.spyOn(nav, 'closePool').mockResolvedValue(undefined);

    batch = spyBatches();
    await caller.integrations.nav.saveConfig({ ...base, password: '' });
    expect(batch()).toEqual(plain);
  });

  it('backup schedule', async () => {
    const caller = await createCallerAs('admin');
    const batch = spyBatches();
    await caller.maintenance.backup.updateScheduleConfig({
      enabled: true, dailyTime: '02:30', scope: 'DB', retentionDays: 30, retentionMinCount: 3, notifyOnFailure: true,
    });
    expect(batch()).toEqual([
      ['backup.notifyOnFailure', 'plain'], ['backup.retentionDays', 'plain'], ['backup.retentionMinCount', 'plain'],
      ['backup.schedule.dailyTime', 'plain'], ['backup.schedule.enabled', 'plain'], ['backup.schedule.scope', 'plain'],
    ]);
  });
});

describe('saveConfigs', () => {
  it('writes nothing when any value fails its registry schema', async () => {
    await saveConfig(prisma, 'smtp.host', 'old-host');
    await expect(
      configManager.saveConfigs(prisma, [
        { key: 'smtp.host', value: 'new-host' },
        { key: 'smtp.port', value: 'not-a-port' },
      ])
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await getConfig(prisma, 'smtp.host', false)).toBe('old-host');
  });

  it('removes keys, an absent one included, in the same change', async () => {
    await saveConfig(prisma, 'integrations.google.oauth.userEmail', 'a@example.com');
    await configManager.saveConfigs(prisma, [
      { key: 'integrations.google.oauth.userEmail', value: null },
      { key: 'integrations.google.impersonateEmail', value: null },
      { key: 'smtp.host', value: 'h' },
    ]);
    expect(await getConfig(prisma, 'integrations.google.oauth.userEmail', false)).toBeNull();
    expect(await getConfig(prisma, 'smtp.host', false)).toBe('h');
  });

  it('stores an encrypted value the reader decrypts', async () => {
    await configManager.saveConfigs(prisma, [{ key: 'smtp.pass', value: 'secret', encrypt: true }]);
    const row = await prisma.appConfig.findUnique({ where: { key: 'smtp.pass' } });
    expect(row?.isEncrypted).toBe(true);
    expect(row?.value).not.toBe('secret');
    expect(await getConfig(prisma, 'smtp.pass', true)).toBe('secret');
  });

  it('invalidates the RBAC cache after committing an rbac key', async () => {
    await getRbacConfig(prisma); // prime the cache
    await configManager.saveConfigs(prisma, [
      { key: 'rbac.sectionAccessDefaults', value: JSON.stringify({ viewer: { 'admin.brands': 'enabled' } }) },
    ]);
    expect((await getRbacConfig(prisma)).sectionAccessDefaults.viewer['admin.brands']).toBe('enabled');
  });

  it('cannot write the kill switch, whose guard runs its own transaction', () => {
    // @ts-expect-error — `app.sections.disabled` is excluded from the batch key type.
    void (() => configManager.saveConfigs(prisma, [{ key: 'app.sections.disabled', value: '[]' }]));
    // @ts-expect-error — and from removals.
    void (() => configManager.saveConfigs(prisma, [{ key: 'app.sections.disabled', value: null }]));
  });
});
