/**
 * The contract of `getPasswordPolicy`: how the five `security.password.*` keys in AppConfig become
 * the policy the server applies.
 *
 * Nothing covered it. It governs four password-setting paths rather than one, so what it reads —
 * and what happens when a key is missing or malformed — stops being a detail.
 *
 * Integration, because it reads AppConfig; the validation itself is pure and lives in
 * `password.spec.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { getPasswordPolicy } from '../src/lib/configManager';

import { createAnonymousCaller, resetTestData, setupTestDb } from './helpers';


let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  await resetTestData();
});

/** Writes only the keys passed in, so each test declares what it depends on. */
async function seedPolicy(values: Record<string, string>): Promise<void> {
  await prisma.appConfig.createMany({
    data: Object.entries(values).map(([key, value]) => ({ key, value, isEncrypted: false })),
  });
}

describe('getPasswordPolicy — what it reads', () => {
  it('with no key at all it returns the safe default: everything on, 12 characters', () => {
    // The fallback lives in a per-key `.catch()`: `getTypedConfig` throws when the key is absent.
    // The default has to be the strictest option, not the most permissive.
    return expect(getPasswordPolicy(prisma)).resolves.toEqual({
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireDigit: true,
      requireSpecialChar: true,
    });
  });

  it('reads minLength from the configuration', async () => {
    await seedPolicy({ 'security.password.minLength': '16' });
    await expect(getPasswordPolicy(prisma)).resolves.toMatchObject({ minLength: 16 });
  });

  it('accepts the exact floor', async () => {
    await seedPolicy({ 'security.password.minLength': '8' });
    await expect(getPasswordPolicy(prisma)).resolves.toMatchObject({ minLength: 8 });
  });

  for (const below of ['7', '4']) {
    it(`below the floor (${below}) it falls back to the default, which is stricter`, async () => {
      // One floor, declared in the registry: a value that does not meet it fails to parse and the
      // `.catch()` returns the default. There used to be three numbers for one rule, so the answer
      // depended on how far below you went — 7 became 8, 4 became 12.
      await seedPolicy({ 'security.password.minLength': below });
      await expect(getPasswordPolicy(prisma)).resolves.toMatchObject({ minLength: 12 });
    });
  }

  it('an unreadable key does not break the policy, it falls back to the default', async () => {
    await seedPolicy({ 'security.password.minLength': 'non-un-numero' });
    await expect(getPasswordPolicy(prisma)).resolves.toMatchObject({ minLength: 12 });
  });
});

/**
 * The four toggles must be able to switch off.
 *
 * A policy that can only ever become stricter is not configurable: it is a constant with a control
 * panel. While `validatePassword` had a single call site the defect stayed small — extended to four
 * paths, a requirement that cannot be switched off becomes a lockout.
 */
describe('getPasswordPolicy — switching a requirement off really switches it off', () => {
  const toggles = [
    'requireUppercase',
    'requireLowercase',
    'requireDigit',
    'requireSpecialChar',
  ] as const;

  for (const toggle of toggles) {
    it(`${toggle} = "false" disables the requirement`, async () => {
      await seedPolicy({ [`security.password.${toggle}`]: 'false' });
      await expect(getPasswordPolicy(prisma)).resolves.toMatchObject({ [toggle]: false });
    });

    it(`${toggle} = "true" leaves it on`, async () => {
      await seedPolicy({ [`security.password.${toggle}`]: 'true' });
      await expect(getPasswordPolicy(prisma)).resolves.toMatchObject({ [toggle]: true });
    });
  }
});

/**
 * The policy must be readable without a session.
 *
 * The reset page lives outside the authenticated layout — someone setting a new password has no
 * session, by definition — and it is the page that needed this most: it announced a hardcoded
 * minimum, showed no complexity requirements at all, and then relayed a server rejection listing
 * rules it had never mentioned.
 */
describe('public.passwordPolicy', () => {
  it('answers an anonymous client', async () => {
    const anon = await createAnonymousCaller();
    await expect(anon.public.passwordPolicy()).resolves.toMatchObject({
      minLength: 12,
      requireUppercase: true,
    });
  });

  it('reflects the configuration, not a compiled-in default', async () => {
    await seedPolicy({
      'security.password.minLength': '16',
      'security.password.requireSpecialChar': 'false',
    });
    const anon = await createAnonymousCaller();
    await expect(anon.public.passwordPolicy()).resolves.toMatchObject({
      minLength: 16,
      requireSpecialChar: false,
    });
  });

  it('names the characters that count as special', async () => {
    // The client cannot say "a symbol": the server's class is an allowlist, and `~` or a space look
    // acceptable under a vague label right up to the rejection.
    const anon = await createAnonymousCaller();
    const policy = await anon.public.passwordPolicy();
    expect(policy.specialChars).toContain('!');
    expect(policy.specialChars).not.toContain('~');
  });
});
