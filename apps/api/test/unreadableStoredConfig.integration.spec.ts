/**
 * A stored encrypted value this instance cannot decrypt, as after a restore under another master
 * key: the settings page the admin repairs it from still opens with the field marked, and its test
 * buttons and save say what to do instead of failing with a generic error.
 */

import { Client } from 'ldapts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppConfigKey } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { saveConfig } from '../src/lib/configManager';
import { resetStorageProvider } from '../src/storage';

import { createCallerAs, setupTestDb } from './helpers';

const ENTER_IT_AGAIN = { code: 'BAD_REQUEST', message: 'Un valore salvato non è leggibile: inseriscilo di nuovo e salva.' };

let prisma: PrismaClient;
let caller: Awaited<ReturnType<typeof createCallerAs>>;

async function makeUnreadable(key: AppConfigKey) {
  await prisma.appConfig.update({ where: { key }, data: { value: 'not-a-ciphertext', isEncrypted: true } });
}

beforeEach(async () => {
  prisma = await setupTestDb();
  caller = await createCallerAs('admin');
});

afterEach(() => {
  vi.restoreAllMocks();
  resetStorageProvider();
});

describe('LDAP settings', () => {
  const FORM = {
    enabled: true,
    url: 'ldap://dc.test:389',
    bindDN: 'cn=svc,dc=test',
    bindPassword: 'service-password',
    searchBase: 'dc=test',
    searchFilter: '(uid=${username})',
    groupSearchBase: 'ou=groups,dc=test',
    groupSearchFilter: '(member=${userDN})',
    roleMapping: '{"cn=admins,dc=test":"admin"}',
    strategy: 'local-first',
  } as const;

  beforeEach(async () => {
    await caller.integrations.auth.saveLdapConfig(FORM);
  });

  describe.each([true, false])('LDAP enabled: %s', enabled => {
    beforeEach(async () => {
      await saveConfig(prisma, 'auth.ldap.enabled', String(enabled));
    });

    it('the page opens with the unreadable credential marked and the rest as stored', async () => {
      await makeUnreadable('auth.ldap.bindPassword');

      expect(await caller.integrations.auth.getLdapConfig()).toMatchObject({
        enabled,
        url: FORM.url,
        hasBindDN: true,
        hasBindPassword: false,
        searchBase: FORM.searchBase,
        unreadable: ['bindPassword'],
      });
    });

    it('an unreadable field comes back blank', async () => {
      await makeUnreadable('auth.ldap.url');
      await makeUnreadable('auth.ldap.roleMapping');

      const config = await caller.integrations.auth.getLdapConfig();

      expect(config).toMatchObject({ url: '', roleMapping: '', hasBindPassword: true });
      expect([...config.unreadable].sort()).toEqual(['roleMapping', 'url']);
    });

    it('both tests ask for the value again, and bind nothing', async () => {
      const bind = vi.spyOn(Client.prototype, 'bind');
      await makeUnreadable('auth.ldap.bindPassword');

      await expect(caller.integrations.auth.testLdapConnection()).rejects.toMatchObject(ENTER_IT_AGAIN);
      await expect(caller.integrations.auth.testLdapSearch({ username: 'alice' })).rejects.toMatchObject(ENTER_IT_AGAIN);
      expect(bind).not.toHaveBeenCalled();
    });
  });

  it('entering the values again and saving repairs the page and both tests', async () => {
    vi.spyOn(Client.prototype, 'bind').mockResolvedValue(undefined);
    vi.spyOn(Client.prototype, 'unbind').mockResolvedValue(undefined);
    vi.spyOn(Client.prototype, 'search').mockResolvedValue({ searchEntries: [], searchReferences: [] });
    await makeUnreadable('auth.ldap.url');
    await makeUnreadable('auth.ldap.bindPassword');

    await caller.integrations.auth.saveLdapConfig(FORM);

    expect(await caller.integrations.auth.getLdapConfig()).toMatchObject({
      url: FORM.url,
      hasBindPassword: true,
      unreadable: [],
    });
    await expect(caller.integrations.auth.testLdapConnection()).resolves.toMatchObject({ success: true });
    await expect(caller.integrations.auth.testLdapSearch({ username: 'alice' })).resolves.toMatchObject({ success: true });
  });

  it('an unreadable optional field left blank on save is kept, not deleted', async () => {
    await makeUnreadable('auth.ldap.roleMapping');

    await caller.integrations.auth.saveLdapConfig({ ...FORM, roleMapping: '', groupSearchBase: '' });

    expect((await caller.integrations.auth.getLdapConfig()).unreadable).toEqual(['roleMapping']);
    // A readable one left blank is removed, as ever.
    expect(await prisma.appConfig.findUnique({ where: { key: 'auth.ldap.groupSearchBase' } })).toBeNull();
  });

  it('a credential left empty on save stays unreadable', async () => {
    await makeUnreadable('auth.ldap.bindPassword');

    await caller.integrations.auth.saveLdapConfig({ ...FORM, bindDN: '', bindPassword: '' });

    expect((await caller.integrations.auth.getLdapConfig()).unreadable).toEqual(['bindPassword']);
  });
});

describe('storage settings', () => {
  const FORM = {
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

  beforeEach(async () => {
    await caller.storage.saveConfig(FORM);
  });

  it('the page opens with an unreadable access key marked', async () => {
    await makeUnreadable('storage.s3.accessKey');

    expect((await caller.storage.getConfig()).s3).toMatchObject({
      accessKey: '',
      accessKeyUnreadable: true,
      hasSecretKey: true,
      secretKeyUnreadable: false,
    });
  });

  it('an unreadable secret key is reported, not as stored, and never returned', async () => {
    await makeUnreadable('storage.s3.secretKey');

    const { s3 } = await caller.storage.getConfig();

    expect(s3).toMatchObject({ accessKey: 'ak', accessKeyUnreadable: false, hasSecretKey: false, secretKeyUnreadable: true });
    expect(s3).not.toHaveProperty('secretKey');
  });

  it.each(['storage.s3.accessKey', 'storage.s3.secretKey'] as const)('the test asks again for %s', async key => {
    await makeUnreadable(key);

    await expect(caller.storage.testS3Connection()).rejects.toMatchObject(ENTER_IT_AGAIN);
  });

  it('saving a blank secret over an unreadable one asks for it again and writes nothing', async () => {
    await makeUnreadable('storage.s3.secretKey');

    await expect(
      caller.storage.saveConfig({ ...FORM, endpoint: 'other.example.com', secretKey: '' }),
    ).rejects.toMatchObject(ENTER_IT_AGAIN);

    expect((await caller.storage.getConfig()).s3.endpoint).toBe(FORM.endpoint);
  });

  it('entering both keys again and saving repairs the page', async () => {
    await makeUnreadable('storage.s3.accessKey');
    await makeUnreadable('storage.s3.secretKey');

    await caller.storage.saveConfig(FORM);

    expect((await caller.storage.getConfig()).s3).toMatchObject({
      accessKey: 'ak',
      accessKeyUnreadable: false,
      hasSecretKey: true,
      secretKeyUnreadable: false,
    });
  });
});
