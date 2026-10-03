/**
 * `getLdapResilienceConfig` reads six keys whose defaults are declared once, in
 * `APP_CONFIG_DEFAULTS`: absent → default, invalid → default (with a warning), a database
 * failure → thrown, as the rest of the login path's configuration reads.
 */
import { describe, it, expect, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { getLdapResilienceConfig } from '../src/lib/configManager';

function prismaWith(rows: Record<string, string>): PrismaClient {
  const findUnique = vi.fn(async ({ where: { key } }: { where: { key: string } }) =>
    key in rows ? { key, value: rows[key], isEncrypted: false } : null
  );
  // Only `appConfig.findUnique` is reached: each key is one row.
  return { appConfig: { findUnique } } as unknown as PrismaClient;
}

const DEFAULTS = {
  timeoutMs: 3000,
  maxRetries: 2,
  baseDelayMs: 200,
  breakerFailureThreshold: 5,
  breakerCooldownMs: 10000,
  halfOpenMaxAttempts: 1,
};

describe('getLdapResilienceConfig', () => {
  it('reads the declared defaults when nothing is stored', async () => {
    await expect(getLdapResilienceConfig(prismaWith({}))).resolves.toEqual(DEFAULTS);
  });

  it('reads a stored value over its default', async () => {
    const config = await getLdapResilienceConfig(
      prismaWith({
        'auth.ldap.resilience.maxRetries': '0',
        'auth.ldap.resilience.timeoutMs': '5000',
      })
    );
    expect(config).toEqual({ ...DEFAULTS, maxRetries: 0, timeoutMs: 5000 });
  });

  it('falls back to the default for a stored value its schema refuses', async () => {
    const config = await getLdapResilienceConfig(
      prismaWith({ 'auth.ldap.resilience.timeoutMs': '50' })
    );
    expect(config.timeoutMs).toBe(3000);
  });

  it('throws when the database cannot be read', async () => {
    const prisma = {
      appConfig: { findUnique: vi.fn(async () => { throw new Error('connection lost'); }) },
    } as unknown as PrismaClient;
    await expect(getLdapResilienceConfig(prisma)).rejects.toThrow('connection lost');
  });
});
