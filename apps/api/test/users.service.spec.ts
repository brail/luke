/**
 * `resolveEffectiveProvider` (users.service.ts) — picks the provider used for
 * lock/display decisions when a user holds more than one `Identity` (e.g. after
 * `forceLocalAccess` grants a LOCAL identity alongside an existing LDAP one).
 *
 * Regression coverage for the bug this function was introduced to fix: callers used to read
 * `identities[0]` directly, which is only safe when a user has exactly one identity. Once a
 * second identity exists, Postgres gives no ordering guarantee without `orderBy` — the previous
 * code's correctness depended on accidental row order. These tests construct both possible
 * orderings by hand precisely so a reintroduced `identities[0]` read would fail on at least one
 * of them, instead of passing by coincidence the way the pre-fix code sometimes did.
 */

import { describe, it, expect } from 'vitest';

import { getLockedFields, resolveEffectiveProvider } from '../src/services/users.service';

describe('resolveEffectiveProvider', () => {
  it('user with a single LOCAL identity → LOCAL', () => {
    expect(resolveEffectiveProvider([{ provider: 'LOCAL' }])).toBe('LOCAL');
  });

  it('user with a single LDAP identity → LDAP', () => {
    expect(resolveEffectiveProvider([{ provider: 'LDAP' }])).toBe('LDAP');
  });

  it('no identity → LOCAL (defensive fallback)', () => {
    expect(resolveEffectiveProvider([])).toBe('LOCAL');
  });

  it('LDAP created first, LOCAL after (order [LDAP, LOCAL]) → stays LDAP', () => {
    expect(
      resolveEffectiveProvider([{ provider: 'LDAP' }, { provider: 'LOCAL' }])
    ).toBe('LDAP');
  });

  it('LOCAL created first, LDAP after (order [LOCAL, LDAP]) → stays LDAP', () => {
    // This is the ordering that would have broken a naive `identities[0]` read:
    // `identities[0]` here is LOCAL, but the user still has an external identity governing sync.
    expect(
      resolveEffectiveProvider([{ provider: 'LOCAL' }, { provider: 'LDAP' }])
    ).toBe('LDAP');
  });

  it('OIDC + LOCAL, in qualunque ordine → resta OIDC', () => {
    expect(
      resolveEffectiveProvider([{ provider: 'LOCAL' }, { provider: 'OIDC' }])
    ).toBe('OIDC');
    expect(
      resolveEffectiveProvider([{ provider: 'OIDC' }, { provider: 'LOCAL' }])
    ).toBe('OIDC');
  });
});

describe('resolveEffectiveProvider → getLockedFields (integration of the two pure functions)', () => {
  it('dual-identity user (LOCAL+LDAP, in order [LOCAL, LDAP]) → password stays locked', () => {
    const provider = resolveEffectiveProvider([{ provider: 'LOCAL' }, { provider: 'LDAP' }]);
    expect(getLockedFields(provider)).toContain('password');
  });

  it('LOCAL-only user → no locked field', () => {
    const provider = resolveEffectiveProvider([{ provider: 'LOCAL' }]);
    expect(getLockedFields(provider)).toEqual([]);
  });
});
