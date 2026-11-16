/**
 * The LDAP search-test username cap lives here now, and the router imports this schema. Dropping
 * the cap fails this test and `apps/api/test/coreInputSchemas.integration.spec.ts`.
 */

import { describe, it, expect } from 'vitest';

import { LdapStrategyInputSchema, ldapConfigSchema, ldapSearchTestSchema } from '../ldap.js';

describe('ldapSearchTestSchema', () => {
  it('accepts a username of 256 characters and refuses 257', () => {
    expect(ldapSearchTestSchema.safeParse({ username: 'a'.repeat(256) }).success).toBe(true);

    const result = ldapSearchTestSchema.safeParse({ username: 'a'.repeat(257) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Username troppo lungo (max 256 caratteri)');
  });
});

// #246: the strategy has its own save; the connection settings no longer carry it.
describe('ldapConfigSchema', () => {
  it('drops a strategy sent with the connection settings', () => {
    const config = { enabled: false, url: 'ldap://dc.example.com', searchBase: 'dc=example,dc=com', searchFilter: '(uid=${username})' };

    expect(ldapConfigSchema.parse({ ...config, strategy: 'ldap-only' })).not.toHaveProperty('strategy');
  });
});

describe('LdapStrategyInputSchema', () => {
  it('takes one of the four strategies, nothing else', () => {
    expect(LdapStrategyInputSchema.safeParse({ strategy: 'ldap-only' }).success).toBe(true);
    expect(LdapStrategyInputSchema.safeParse({ strategy: 'ldap-sometimes' }).success).toBe(false);
  });
});

describe('the role mapping (#112)', () => {
  const config = {
    enabled: true,
    url: 'ldap://dc.example.com',
    searchBase: 'dc=example,dc=com',
    searchFilter: '(uid=${username})',
  };
  const mapping = (value: unknown) => JSON.stringify(value);

  it('accepts a mapping to known roles, and an empty one', () => {
    expect(ldapConfigSchema.safeParse({ ...config, roleMapping: mapping({ 'CN=Admins': 'admin' }) }).success).toBe(true);
    expect(ldapConfigSchema.safeParse({ ...config, roleMapping: '' }).success).toBe(true);
  });

  it('refuses a mistyped role on the field, naming the group', () => {
    const result = ldapConfigSchema.safeParse({ ...config, roleMapping: mapping({ 'CN=Admins': 'admn' }) });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['roleMapping']);
    expect(result.error?.issues[0]?.message).toContain('CN=Admins');
  });

  it('refuses JSON that is not an object of roles', () => {
    expect(ldapConfigSchema.safeParse({ ...config, roleMapping: '["admin"]' }).success).toBe(false);
    expect(ldapConfigSchema.safeParse({ ...config, roleMapping: '{not json' }).success).toBe(false);
  });
});
