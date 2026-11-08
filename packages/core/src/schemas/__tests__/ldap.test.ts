/**
 * The LDAP search-test username cap lives here now, and the router imports this schema. Dropping
 * the cap fails this test and `apps/api/test/coreInputSchemas.integration.spec.ts`.
 */

import { describe, it, expect } from 'vitest';

import { ldapConfigSchema, ldapSearchTestSchema } from '../ldap.js';

describe('ldapSearchTestSchema', () => {
  it('accepts a username of 256 characters and refuses 257', () => {
    expect(ldapSearchTestSchema.safeParse({ username: 'a'.repeat(256) }).success).toBe(true);

    const result = ldapSearchTestSchema.safeParse({ username: 'a'.repeat(257) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Username troppo lungo (max 256 caratteri)');
  });
});

describe('ldapConfigSchema', () => {
  const config = {
    enabled: true,
    url: 'ldap://dc.example.com',
    searchBase: 'dc=example,dc=com',
    searchFilter: '(uid=${username})',
    strategy: 'ldap-only' as const,
  };

  it('refuses ldap-only with LDAP disabled, on the strategy field so the form shows it there', () => {
    const result = ldapConfigSchema.safeParse({ ...config, enabled: false });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map(issue => issue.path)).toEqual([['strategy']]);
  });

  it('accepts ldap-only with LDAP enabled, and every other strategy with LDAP disabled', () => {
    expect(ldapConfigSchema.safeParse(config).success).toBe(true);
    for (const strategy of ['local-only', 'local-first', 'ldap-first'] as const) {
      expect(ldapConfigSchema.safeParse({ ...config, strategy, enabled: false }).success).toBe(true);
    }
  });
});

describe('the role mapping (#112)', () => {
  const config = {
    enabled: true,
    url: 'ldap://dc.example.com',
    searchBase: 'dc=example,dc=com',
    searchFilter: '(uid=${username})',
    strategy: 'local-first' as const,
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
