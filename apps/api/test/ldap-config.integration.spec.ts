import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { PrismaClient } from '@luke/db';

import { getLdapConfig } from '../src/lib/configManager';

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

  it('restituisce configurazione di default quando non esistono configurazioni LDAP', async () => {
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

  it('restituisce configurazione parziale quando esistono solo alcune configurazioni', async () => {
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

  it('gestisce correttamente configurazioni non cifrate', async () => {
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
});
