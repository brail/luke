/**
 * A stored encrypted value this instance cannot decrypt, as after a restore under another master
 * key: the settings page the admin repairs it from still opens with the field marked, and its test
 * buttons and save say what to do instead of failing with a generic error.
 */

import { Client } from 'ldapts';
import nodemailer from 'nodemailer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as calendar from '@luke/calendar';
import type { AppConfigKey } from '@luke/core';
import type { PrismaClient } from '@luke/db';
import * as nav from '@luke/nav';

import { saveConfig, saveConfigs } from '../src/lib/configManager';
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

describe('mail settings', () => {
  const FORM = {
    host: 'smtp.test',
    port: 587,
    secure: false,
    user: 'mailer',
    pass: 'smtp-password',
    from: 'luke@example.com',
    baseUrl: 'https://luke.example.com',
  };
  const verify = vi.fn(async () => true);

  beforeEach(async () => {
    verify.mockClear();
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({
      verify,
      sendMail: vi.fn(async () => ({ messageId: 'id' })),
      close: vi.fn(),
    } as never); // Only what the test procedure calls of a transport.
    await caller.integrations.mail.saveConfig(FORM);
  });

  it('with every value readable the test reaches the server', async () => {
    await caller.integrations.mail.test({});

    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: { user: 'mailer', pass: 'smtp-password' } }));
  });

  it('the test asks again for an unreadable password, and connects to nothing', async () => {
    await makeUnreadable('smtp.pass');

    await expect(caller.integrations.mail.test({})).rejects.toMatchObject(ENTER_IT_AGAIN);
    expect(verify).not.toHaveBeenCalled();
  });

  it('entering the password again and saving repairs the test', async () => {
    await makeUnreadable('smtp.pass');

    await caller.integrations.mail.saveConfig({ ...FORM, pass: 'new-password' });
    await caller.integrations.mail.test({});

    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: { user: 'mailer', pass: 'new-password' } }));
  });
});

describe('NAV settings', () => {
  const FORM = {
    host: 'nav.test',
    port: 1433,
    database: 'NAV',
    user: 'reader',
    password: 'nav-password',
    company: 'CO',
    readOnly: true,
    syncEnabled: false,
  };
  const connects = () => vi.mocked(nav.testNavConnection);

  beforeEach(async () => {
    vi.spyOn(nav, 'closePool').mockResolvedValue(undefined);
    vi.spyOn(nav, 'testNavConnection').mockResolvedValue({ success: true, steps: [] });
    await caller.integrations.nav.saveConfig(FORM);
  });

  it('with every value readable the test reaches the server', async () => {
    await caller.integrations.nav.testConnection();

    expect(connects()).toHaveBeenCalledWith(expect.objectContaining({ password: 'nav-password' }));
  });

  it('the test asks again for an unreadable password, and connects to nothing', async () => {
    await makeUnreadable('integrations.nav.password');

    await expect(caller.integrations.nav.testConnection()).rejects.toMatchObject(ENTER_IT_AGAIN);
    expect(connects()).not.toHaveBeenCalled();
  });

  it('a missing password is still reported as incomplete', async () => {
    await prisma.appConfig.delete({ where: { key: 'integrations.nav.password' } });

    await expect(caller.integrations.nav.testConnection()).rejects.toThrow(/incompleta/);
  });

  it('entering the password again and saving repairs the test', async () => {
    await makeUnreadable('integrations.nav.password');

    await caller.integrations.nav.saveConfig({ ...FORM, password: 'new-password' });
    await caller.integrations.nav.testConnection();

    expect(connects()).toHaveBeenCalledWith(expect.objectContaining({ password: 'new-password' }));
  });
});

describe('Google settings', () => {
  const connects = () => vi.mocked(calendar.testGoogleConnection);

  beforeEach(() => {
    vi.spyOn(calendar, 'testGoogleConnection').mockResolvedValue({ ok: true });
  });

  describe('service account', () => {
    const FORM = {
      authMode: 'service_account',
      domain: 'example.com',
      calendarSyncEnabled: false,
      serviceEmail: 'luke@project.iam.gserviceaccount.com',
      serviceKey: 'service-key-sentinel',
      impersonateEmail: '',
    } as const;

    beforeEach(async () => {
      await caller.integrations.google.saveConfig(FORM);
    });

    it('with the key readable the page reports it without its value, and the test connects', async () => {
      const config = await caller.integrations.google.getConfig();

      expect(config).toMatchObject({ hasServiceKey: true, serviceKeyUnreadable: false });
      expect(JSON.stringify(config)).not.toContain(FORM.serviceKey);

      await expect(caller.integrations.google.testConnection()).resolves.toEqual({ ok: true });
      expect(connects()).toHaveBeenCalledWith(expect.objectContaining({ serviceAccountPrivateKey: FORM.serviceKey }));
    });

    it('an unreadable key is marked, not reported as stored, and the test asks for it again', async () => {
      await makeUnreadable('integrations.google.serviceKey');

      expect(await caller.integrations.google.getConfig()).toMatchObject({ hasServiceKey: false, serviceKeyUnreadable: true });
      await expect(caller.integrations.google.testConnection()).rejects.toMatchObject(ENTER_IT_AGAIN);
      expect(connects()).not.toHaveBeenCalled();
    });

    it('a save that leaves the key blank keeps it, still marked', async () => {
      await makeUnreadable('integrations.google.serviceKey');

      await caller.integrations.google.saveConfig({ ...FORM, domain: 'other.example.com', serviceKey: '' });

      expect(await caller.integrations.google.getConfig()).toMatchObject({ domain: 'other.example.com', serviceKeyUnreadable: true });
    });

    it('entering the key again and saving repairs the page and the test', async () => {
      await makeUnreadable('integrations.google.serviceKey');

      await caller.integrations.google.saveConfig({ ...FORM, serviceKey: 'new-key' });

      expect(await caller.integrations.google.getConfig()).toMatchObject({ hasServiceKey: true, serviceKeyUnreadable: false });
      await expect(caller.integrations.google.testConnection()).resolves.toEqual({ ok: true });
    });
  });

  describe('OAuth', () => {
    const FORM = {
      authMode: 'oauth_user',
      domain: 'example.com',
      calendarSyncEnabled: false,
      oauthClientId: 'client-id',
      oauthClientSecret: 'client-secret-sentinel',
    } as const;
    const TOKEN = 'refresh-token-sentinel';
    const REDIRECT_URI = 'https://luke.example.com/api/google/oauth/callback';

    beforeEach(async () => {
      await caller.integrations.google.saveConfig(FORM);
      await saveConfigs(prisma, [
        { key: 'integrations.google.oauth.refreshToken', value: TOKEN, encrypt: true },
        { key: 'integrations.google.oauth.userEmail', value: 'admin@example.com' },
      ]);
    });

    it('with both readable the page reports them without their values, and the test connects', async () => {
      const config = await caller.integrations.google.getConfig();

      expect(config).toMatchObject({
        hasOauthClientSecret: true,
        oauthClientSecretUnreadable: false,
        hasOauthToken: true,
        oauthTokenUnreadable: false,
      });
      expect(JSON.stringify(config)).not.toContain(FORM.oauthClientSecret);
      expect(JSON.stringify(config)).not.toContain(TOKEN);

      await expect(caller.integrations.google.testConnection()).resolves.toEqual({ ok: true });
      expect(connects()).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: TOKEN }));
    });

    it('an unreadable client secret is marked, and the test and the connection ask for it again', async () => {
      await makeUnreadable('integrations.google.oauth.clientSecret');

      expect(await caller.integrations.google.getConfig()).toMatchObject({ hasOauthClientSecret: false, oauthClientSecretUnreadable: true });
      await expect(caller.integrations.google.testConnection()).rejects.toMatchObject(ENTER_IT_AGAIN);
      await expect(caller.integrations.google.getOAuthUrl({ redirectUri: REDIRECT_URI })).rejects.toMatchObject(ENTER_IT_AGAIN);
      expect(connects()).not.toHaveBeenCalled();
    });

    it('a connection already started asks again for a client secret unreadable by its return', async () => {
      const { url } = await caller.integrations.google.getOAuthUrl({ redirectUri: REDIRECT_URI });
      const state = new URL(url).searchParams.get('state') ?? '';
      await makeUnreadable('integrations.google.oauth.clientSecret');

      await expect(
        caller.integrations.google.exchangeOAuthCode({ code: 'code', state, redirectUri: REDIRECT_URI }),
      ).rejects.toMatchObject(ENTER_IT_AGAIN);
    });

    it('an unreadable token is marked with its account, and the test asks to connect again', async () => {
      await makeUnreadable('integrations.google.oauth.refreshToken');

      expect(await caller.integrations.google.getConfig()).toMatchObject({
        hasOauthToken: false,
        oauthTokenUnreadable: true,
        oauthUserEmail: 'admin@example.com',
      });
      await expect(caller.integrations.google.testConnection()).resolves.toEqual({
        ok: false,
        error: "Il token salvato non è leggibile: connetti di nuovo l'account.",
      });
      expect(connects()).not.toHaveBeenCalled();
    });

    it('an unreadable token can be disconnected', async () => {
      await makeUnreadable('integrations.google.oauth.refreshToken');

      await caller.integrations.google.disconnectOAuth();

      expect(await caller.integrations.google.getConfig()).toMatchObject({ hasOauthToken: false, oauthTokenUnreadable: false, oauthUserEmail: '' });
    });

    it('entering the client secret again and saving repairs the page and the connection', async () => {
      await makeUnreadable('integrations.google.oauth.clientSecret');

      await caller.integrations.google.saveConfig({ ...FORM, oauthClientSecret: 'new-secret' });

      expect(await caller.integrations.google.getConfig()).toMatchObject({ hasOauthClientSecret: true, oauthClientSecretUnreadable: false });
      await expect(caller.integrations.google.getOAuthUrl({ redirectUri: REDIRECT_URI })).resolves.toHaveProperty('url');
    });
  });
});
