/**
 * `integrations.google.exchangeOAuthCode` stores the refresh token and the account address as one
 * outcome.
 *
 * Only the calendar scope is requested, so Google's userinfo answer can carry no address. The
 * client turned that into `''`, which the registry refuses (`.email()`): the save failed after the
 * new refresh token was already stored, the audit row was skipped, and the settings page kept
 * showing the previous account's address. A missing address now removes the stored one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as calendar from '@luke/calendar';
import type { PrismaClient } from '@luke/db';

import { getConfig, saveConfig } from '../src/lib/configManager';

import { createCallerAs, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  await saveConfig(prisma, 'integrations.google.oauth.clientId', 'client-id');
  await saveConfig(prisma, 'integrations.google.oauth.clientSecret', 'client-secret', true);
  await saveConfig(prisma, 'integrations.google.oauth.userEmail', 'previous@example.com');
});

afterEach(() => {
  vi.restoreAllMocks();
});

const exchange = async (userEmail: string | null) => {
  // Spied on the package namespace: `appRouter` is loaded by the setup file before any `vi.mock`.
  vi.spyOn(calendar, 'exchangeOAuthCode').mockResolvedValue({ refreshToken: 'new-token', userEmail });
  const caller = await createCallerAs('admin');
  return caller.integrations.google.exchangeOAuthCode({ code: 'code', redirectUri: 'https://luke.example.com/cb' });
};

describe('integrations.google.exchangeOAuthCode', () => {
  it('stores the token and the address, and audits the connection', async () => {
    await expect(exchange('new@example.com')).resolves.toEqual({ userEmail: 'new@example.com' });

    expect(await getConfig(prisma, 'integrations.google.oauth.refreshToken', true)).toBe('new-token');
    expect(await getConfig(prisma, 'integrations.google.oauth.userEmail', false)).toBe('new@example.com');
    expect(await prisma.auditLog.count({ where: { action: 'CONFIG_GOOGLE_OAUTH_CONNECT' } })).toBe(1);
  });

  it('with no address in Google’s answer, removes the stored one instead of failing half-way', async () => {
    await expect(exchange(null)).resolves.toEqual({ userEmail: null });

    expect(await getConfig(prisma, 'integrations.google.oauth.refreshToken', true)).toBe('new-token');
    expect(await getConfig(prisma, 'integrations.google.oauth.userEmail', false)).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'CONFIG_GOOGLE_OAUTH_CONNECT' } })).toBe(1);
  });
});
