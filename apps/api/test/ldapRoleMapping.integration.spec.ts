/**
 * The LDAP role mapping answers to the registry (#112): a mistyped role is refused on save, naming
 * the group. A mapping an earlier release stored invalid is dropped whole at sign-in (D3a); the
 * settings page gets it as stored and marked, instead of as an empty mapping, a save that sends it
 * back unchanged is refused, and a valid one replaces it.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { createCallerAs, setupTestDb } from './helpers';

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
const INVALID = '{"cn=admins,dc=test":"admn"}';

let prisma: PrismaClient;
let caller: Awaited<ReturnType<typeof createCallerAs>>;

beforeEach(async () => {
  prisma = await setupTestDb();
  caller = await createCallerAs('admin');
  await caller.integrations.auth.saveLdapConfig(FORM);
});

const storedMapping = () => prisma.appConfig.findUnique({ where: { key: 'auth.ldap.roleMapping' } });

describe('saving a role mapping', () => {
  it('refuses a mistyped role, naming the group, from the LDAP page and from Maintenance → Config', async () => {
    const before = await storedMapping();

    await expect(caller.integrations.auth.saveLdapConfig({ ...FORM, roleMapping: INVALID })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: expect.stringContaining('cn=admins,dc=test'),
    });
    await expect(caller.config.set({ key: 'auth.ldap.roleMapping', value: INVALID, encrypt: true })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(await storedMapping()).toEqual(before);
  });
});

describe('a role mapping an earlier release stored invalid', () => {
  beforeEach(async () => {
    // Written straight to the table: no save stores it any more.
    await prisma.appConfig.update({ where: { key: 'auth.ldap.roleMapping' }, data: { value: INVALID, isEncrypted: false } });
  });

  it('is given to the page as stored and marked, not as an empty mapping', async () => {
    expect(await caller.integrations.auth.getLdapConfig()).toMatchObject({
      roleMapping: INVALID,
      roleMappingInvalid: true,
      unreadable: [],
    });
  });

  it('is not saved again unchanged: the save is refused and the row stays', async () => {
    await expect(caller.integrations.auth.saveLdapConfig({ ...FORM, roleMapping: INVALID })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });

    expect(await storedMapping()).toMatchObject({ value: INVALID });
  });

  it('is replaced by a save with a valid mapping', async () => {
    await caller.integrations.auth.saveLdapConfig(FORM);

    expect(await caller.integrations.auth.getLdapConfig()).toMatchObject({
      roleMapping: JSON.stringify({ 'cn=admins,dc=test': 'admin' }, null, 2),
      roleMappingInvalid: false,
    });
  });
});
