/**
 * The bootstrap env policy (`lib/envPolicy.ts`): application settings by name, and
 * `NODE_TLS_REJECT_UNAUTHORIZED=0` by value (#283). Production refuses, everything else warns.
 */

import { describe, expect, it, vi } from 'vitest';

import { EnvPolicyError, assertEnvPolicy } from '../src/lib/envPolicy';

const run = (env: NodeJS.ProcessEnv, nodeEnv: string | undefined) => {
  const logger = { warn: vi.fn() };
  let error: unknown;
  try {
    assertEnvPolicy({ ...env, NODE_ENV: nodeEnv }, logger);
  } catch (err) {
    error = err;
  }
  return { error, warnings: logger.warn.mock.calls.map(([message]) => String(message)) };
};

const NOT_PRODUCTION = [undefined, 'development', 'test'];

describe('assertEnvPolicy — application settings by name', () => {
  it('refuses a forbidden name in production, listing every match', () => {
    const { error } = run({ SMTP_HOST: 'mail', LDAP_URL: 'ldap://x', PATH: '/bin' }, 'production');
    expect(error).toBeInstanceOf(EnvPolicyError);
    expect((error as Error).message).toContain('SMTP_HOST, LDAP_URL');
  });

  it.each(NOT_PRODUCTION)('warns outside production (NODE_ENV=%s)', nodeEnv => {
    const { error, warnings } = run({ SMTP_HOST: 'mail' }, nodeEnv);
    expect(error).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('SMTP_HOST');
  });

  it('passes names that match no pattern', () => {
    expect(run({ PATH: '/bin', DATABASE_URL: 'postgres://x' }, 'production')).toEqual({ error: undefined, warnings: [] });
  });
});

describe('assertEnvPolicy — TLS verification switched off', () => {
  it('refuses NODE_TLS_REJECT_UNAUTHORIZED=0 in production, naming the variable and the reason', () => {
    const { error } = run({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, 'production');
    expect(error).toBeInstanceOf(EnvPolicyError);
    expect((error as Error).message).toContain('NODE_TLS_REJECT_UNAUTHORIZED=0');
    expect((error as Error).message).toContain('certificate verification');
  });

  it.each(NOT_PRODUCTION)('warns once outside production (NODE_ENV=%s)', nodeEnv => {
    const { error, warnings } = run({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, nodeEnv);
    expect(error).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('NODE_TLS_REJECT_UNAUTHORIZED=0');
  });

  // Node turns verification off for exactly '0' (`getAllowUnauthorized`, lib/internal/options.js).
  it.each(['1', '', ' 0', '00', 'false', undefined])('passes silently for %j, which Node keeps verifying', value => {
    for (const nodeEnv of ['production', ...NOT_PRODUCTION]) {
      expect(run({ NODE_TLS_REJECT_UNAUTHORIZED: value }, nodeEnv)).toEqual({ error: undefined, warnings: [] });
    }
  });

  it('names both problems in one production error', () => {
    const { error } = run({ NODE_TLS_REJECT_UNAUTHORIZED: '0', SMTP_HOST: 'mail' }, 'production');
    expect((error as Error).message).toContain('SMTP_HOST');
    expect((error as Error).message).toContain('NODE_TLS_REJECT_UNAUTHORIZED=0');
  });

  it('warns once per kind outside production', () => {
    const { warnings } = run({ NODE_TLS_REJECT_UNAUTHORIZED: '0', SMTP_HOST: 'mail' }, 'development');
    expect(warnings).toHaveLength(2);
  });
});
