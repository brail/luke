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
