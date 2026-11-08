/**
 * A key whose reader never decrypts (`PLAINTEXT_CONFIG_KEYS`) is stored in plaintext whatever the
 * caller asks (#214): stored encrypted, the kill switch was ciphertext to `getRbacConfig` and
 * disabled nothing, while its guard had approved the plaintext list.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { CONFIG_SECRET_PLACEHOLDER } from '@luke/core';
import { getRbacConfig, invalidateRbacCache } from '@luke/core/server';
import type { PrismaClient } from '@luke/db';

import { isLdapEnabled } from '../src/lib/configManager';

import { createCallerAs, createCallerWithSession, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
  invalidateRbacCache();
});

const row = (key: string) => prisma.appConfig.findUnique({ where: { key } });

describe('a plaintext key is stored in plaintext whatever the caller asks', () => {
  it('config.set stores the kill switch in plaintext, and the section is disabled', async () => {
    const caller = await createCallerAs('admin');

    const result = await caller.config.set({
      key: 'app.sections.disabled',
      value: '["settings.storage"]',
      encrypt: true,
    });

    expect(await row('app.sections.disabled')).toMatchObject({ value: '["settings.storage"]', isEncrypted: false });
    expect(result).toMatchObject({ isEncrypted: false });
    expect((await getRbacConfig(prisma, { bypassCache: true })).disabledSections).toEqual(['settings.storage']);
  });

  it('config.importJson stores the kill switch in plaintext, and refuses an exported placeholder', async () => {
    const caller = await createCallerAs('admin');
    const appNameBefore = await row('app.name');

    const result = await caller.config.importJson({
      items: [
        { key: 'app.sections.disabled', value: '["settings.storage"]', encrypt: true },
        { key: 'app.name', value: CONFIG_SECRET_PLACEHOLDER, encrypt: true },
      ],
    });

    expect(result.successCount).toBe(1);
    expect(await row('app.sections.disabled')).toMatchObject({ isEncrypted: false });
    expect((await getRbacConfig(prisma, { bypassCache: true })).disabledSections).toEqual(['settings.storage']);
    expect(result.errors.map(e => e.key)).toEqual(['app.name']);
    expect(await row('app.name')).toEqual(appNameBefore);
  });

  it('config.set stores the LDAP switch and strategy in plaintext, and LDAP reads them', async () => {
    const caller = await createCallerAs('admin');

    await caller.config.set({ key: 'auth.ldap.enabled', value: 'true', encrypt: true });
    await caller.config.set({ key: 'auth.strategy', value: 'ldap-first', encrypt: true });

    expect(await row('auth.ldap.enabled')).toMatchObject({ value: 'true', isEncrypted: false });
    expect(await row('auth.strategy')).toMatchObject({ value: 'ldap-first', isEncrypted: false });
    expect(await isLdapEnabled(prisma)).toBe(true);
  });
});

describe('an encrypted kill switch already stored', () => {
  beforeEach(async () => {
    // Written straight to the table: no writer stores it encrypted any more.
    await prisma.appConfig.create({
      data: { key: 'app.sections.disabled', value: 'not-a-ciphertext', isEncrypted: true },
    });
  });

  it('disables nothing', async () => {
    expect((await getRbacConfig(prisma, { bypassCache: true })).disabledSections).toEqual([]);
  });

  it('is repaired only through the guard, which refuses to lock the administrators out', async () => {
    const { session } = await createTestUser('admin');
    await expect(
      createCallerWithSession(session).config.set({
        key: 'app.sections.disabled',
        value: '["settings.users"]',
        encrypt: false,
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await row('app.sections.disabled')).toMatchObject({ value: 'not-a-ciphertext' });
  });
});
