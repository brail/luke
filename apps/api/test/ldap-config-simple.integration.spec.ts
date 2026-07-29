/**
 * Test semplificato per le configurazioni LDAP
 * Usa un database in memoria per evitare interferenze con il database di sviluppo
 */

import { PrismaClient } from '@prisma/client';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { getLdapConfig } from '../src/lib/configManager';

import { setupTestDb, teardownTestDb } from './helpers';

describe('LDAP Config Management (Simple)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
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

  it('gestisce correttamente configurazioni parziali', async () => {
    // Crea solo alcune configurazioni LDAP
    await prisma.appConfig.createMany({
      data: [
        {
          key: 'auth.ldap.enabled',
          value: 'true',
          isEncrypted: false,
        },
        {
          key: 'auth.ldap.url',
          value: 'ldap://example.com',
          isEncrypted: false,
        },
        {
          key: 'auth.strategy',
          value: 'ldap-first',
          isEncrypted: false,
        },
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
});




