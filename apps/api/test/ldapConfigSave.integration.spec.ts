/**
 * `integrations.auth.saveLdapConfig` writes through the same rules as `saveConfig`.
 *
 * It writes its keys in one transaction with `tx.appConfig.upsert`, which is atomic but used to
 * consult no registry schema: a value `ldapConfigSchema` accepts and the registry refuses was
 * stored anyway, and an empty optional field was stored as `''` — `roleMapping: ''` is not JSON,
 * so the reader logged a parse error on every login. Now every value is checked before the
 * transaction, and an empty optional field removes its key.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { getConfig, saveConfig } from '../src/lib/configManager';

import { createCallerAs, setupTestDb } from './helpers';

let prisma: PrismaClient;

const input = {
  enabled: true,
  url: 'ldap://dc.example.com:389',
  bindDN: 'cn=svc,dc=example,dc=com',
  bindPassword: '',
  searchBase: 'dc=example,dc=com',
  searchFilter: '(uid={{username}})',
  groupSearchBase: '',
  groupSearchFilter: '',
  roleMapping: '',
  strategy: 'local-first' as const,
};

beforeEach(async () => {
  prisma = await setupTestDb();
  await saveConfig(prisma, 'auth.ldap.url', 'ldap://old.example.com', true);
  await saveConfig(prisma, 'auth.ldap.groupSearchBase', 'ou=groups,dc=old', true);
  await saveConfig(prisma, 'auth.ldap.roleMapping', '{"old":"admin"}', true);
});

describe('integrations.auth.saveLdapConfig', () => {
  it('removes the key of an emptied optional field instead of storing an empty string', async () => {
    const caller = await createCallerAs('admin');

    await caller.integrations.auth.saveLdapConfig(input);

    expect(await getConfig(prisma, 'auth.ldap.url', true)).toBe('ldap://dc.example.com:389');
    expect(await prisma.appConfig.findUnique({ where: { key: 'auth.ldap.groupSearchBase' } })).toBeNull();
    expect(await prisma.appConfig.findUnique({ where: { key: 'auth.ldap.roleMapping' } })).toBeNull();
  });

  it('refuses a value the registry does not accept before writing any key', async () => {
    const caller = await createCallerAs('admin');

    // Passes `ldapConfigSchema` (it only checks the ldap:// prefix), not the registry's `.url()`.
    await expect(
      caller.integrations.auth.saveLdapConfig({ ...input, url: 'ldap://dc example.com', searchBase: 'dc=new' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    expect(await getConfig(prisma, 'auth.ldap.url', true)).toBe('ldap://old.example.com');
    expect(await prisma.appConfig.findUnique({ where: { key: 'auth.ldap.searchBase' } })).toBeNull();
  });
});
