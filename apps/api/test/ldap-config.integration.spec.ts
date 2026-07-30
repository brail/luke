import { PrismaClient } from '@prisma/client';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

import { getLdapConfig } from '../src/lib/configManager';

import { setupTestDb } from './helpers/database';

describe('LDAP Config Management', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  beforeEach(async () => {
    // Il prefisso è `auth.`, non `auth.ldap.`: quello stretto lasciava dietro
    // `auth.strategy`, e il test sul default passava solo se girava per primo.
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
    // `createMany`, non `upsert`: il `beforeEach` ha già ripulito il prefisso,
    // quindi non c'è nulla da aggiornare.
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
    expect(config.bindDN).toBe(''); // Valore di default
    expect(config.bindPassword).toBe(''); // Valore di default
    expect(config.searchBase).toBe(''); // Valore di default
    expect(config.searchFilter).toBe(''); // Valore di default
    expect(config.groupSearchBase).toBe(''); // Valore di default
    expect(config.groupSearchFilter).toBe(''); // Valore di default
    expect(config.roleMapping).toEqual({}); // Valore di default
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
    expect(config.url).toBe(''); // Valore di default
  });
});
