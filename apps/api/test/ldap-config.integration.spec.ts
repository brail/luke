import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { PrismaClient } from '@luke/db';

import { getLdapConfig, saveConfig } from '../src/lib/configManager';
import { checkLdap } from '../src/observability/readiness';

import { setupTestDb } from './helpers/database';

describe('LDAP Config Management', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  beforeEach(async () => {
    // The prefix is `auth.`, not `auth.ldap.`: the narrower one left
    // `auth.strategy` behind, and the default test only passed if it ran first.
    await prisma.appConfig.deleteMany({ where: { key: { startsWith: 'auth.' } } });
  });

  it('returns the default configuration when no LDAP configuration exists', async () => {
    const config = await getLdapConfig(prisma);

    expect(config).toEqual({
      enabled: false,
      url: '',
      bindDN: '',
      bindPassword: '',
      searchBase: '',
      searchFilter: '',
      groupSearchBase: '',
      groupSearchFilter: '',
      roleMapping: {},
      strategy: 'local-first',
    });
  });

  it('returns a partial configuration when only some keys exist', async () => {
    // `createMany`, not `upsert`: the `beforeEach` has already cleared the prefix,
    // so there's nothing to update.
    await prisma.appConfig.createMany({
      data: [
        { key: 'auth.ldap.enabled', value: 'true', isEncrypted: false },
        { key: 'auth.ldap.url', value: 'ldap://example.com', isEncrypted: false },
        { key: 'auth.strategy', value: 'ldap-first', isEncrypted: false },
      ],
    });

    const config = await getLdapConfig(prisma);

    expect(config.enabled).toBe(true);
    expect(config.url).toBe('ldap://example.com');
    expect(config.strategy).toBe('ldap-first');
    expect(config.bindDN).toBe(''); // Default value
    expect(config.bindPassword).toBe(''); // Default value
    expect(config.searchBase).toBe(''); // Default value
    expect(config.searchFilter).toBe(''); // Default value
    expect(config.groupSearchBase).toBe(''); // Default value
    expect(config.groupSearchFilter).toBe(''); // Default value
    expect(config.roleMapping).toEqual({}); // Default value
  });

  it('handles unencrypted configuration correctly', async () => {
    await prisma.appConfig.createMany({
      data: [
        { key: 'auth.ldap.enabled', value: 'true', isEncrypted: false },
        {
          key: 'auth.ldap.bindDN',
          value: 'cn=admin,dc=example,dc=com',
          isEncrypted: false,
        },
        { key: 'auth.ldap.bindPassword', value: 'secret123', isEncrypted: false },
      ],
    });

    const config = await getLdapConfig(prisma);

    expect(config.enabled).toBe(true);
    expect(config.bindDN).toBe('cn=admin,dc=example,dc=com');
    expect(config.bindPassword).toBe('secret123');
    expect(config.url).toBe(''); // Default value
  });

  describe('the readiness check, LDAP off', () => {
    const SKIPPED = { ok: true, message: 'LDAP disabled, skipped' };

    it('skips a row this instance cannot decrypt', async () => {
      await prisma.appConfig.createMany({
        data: [
          { key: 'auth.ldap.enabled', value: 'false', isEncrypted: false },
          { key: 'auth.ldap.bindPassword', value: 'not-a-ciphertext', isEncrypted: true },
        ],
      });

      expect(await checkLdap(prisma)).toEqual(SKIPPED);
    });

    it('skips when the flag itself cannot be decrypted', async () => {
      await prisma.appConfig.create({
        data: { key: 'auth.ldap.enabled', value: 'not-a-ciphertext', isEncrypted: true },
      });

      expect(await checkLdap(prisma)).toEqual(SKIPPED);
    });

    it('its flag stored encrypted: off', async () => {
      await saveConfig(prisma, 'auth.ldap.enabled', 'true', true);

      expect(await checkLdap(prisma)).toEqual(SKIPPED);
    });
  });

  it('the readiness check, LDAP on: a row this instance cannot decrypt is not ready', async () => {
    await prisma.appConfig.createMany({
      data: [
        { key: 'auth.ldap.enabled', value: 'true', isEncrypted: false },
        // A closed local port: if the read did not fail, this would reach the bind and say so.
        { key: 'auth.ldap.url', value: 'ldap://127.0.0.1:1', isEncrypted: false },
        { key: 'auth.ldap.bindPassword', value: 'not-a-ciphertext', isEncrypted: true },
      ],
    });

    const result = await checkLdap(prisma);

    expect(result.ok).toBe(false);
    // The read itself failed: no bind was tried. A fixed text: `/readyz` is open to anyone.
    expect(result.message).toBe('LDAP configuration cannot be read');
  });
});
