/**
 * The LDAP search-test username cap lives here now, and the router imports this schema. Dropping
 * the cap fails this test and `apps/api/test/coreInputSchemas.integration.spec.ts`.
 */

import { describe, it, expect } from 'vitest';

import { ldapSearchTestSchema } from '../ldap.js';

describe('ldapSearchTestSchema', () => {
  it('accepts a username of 256 characters and refuses 257', () => {
    expect(ldapSearchTestSchema.safeParse({ username: 'a'.repeat(256) }).success).toBe(true);

    const result = ldapSearchTestSchema.safeParse({ username: 'a'.repeat(257) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Username troppo lungo (max 256 caratteri)');
  });
});
