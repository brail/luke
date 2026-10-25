/**
 * A secret is stored encrypted whatever the caller asks.
 *
 * Encryption used to be the caller's choice: `saveConfig` defaulted to plaintext, and the generic
 * `config` router and `importJson` took the flag from the client, so a secret only that router
 * writes (`integrations.github.feedbackToken`) could be stored in the clear and read back by any
 * holder of `config:read`. `SECRET_CONFIG_KEYS` now decides, and every writer applies it; the audit
 * row and the response follow the decision, never the flag. `db:encrypt-secret-config` encrypts
 * the plaintext secret rows an earlier release left behind.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { CONFIG_SECRET_PLACEHOLDER, SECRET_CONFIG_KEYS } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { seedAppConfigs } from '../prisma/seed';
import {
  EncryptSecretsRefused,
  encryptPlainSecretRows,
} from '../scripts/lib/secretConfigRows';
import { encryptValue, getConfig, saveConfigs } from '../src/lib/configManager';

import { createCallerAs, setupTestDb } from './helpers';

const SENTINEL = 'sentinel-secret-7f3a9c2e';
const TOKEN = 'integrations.github.feedbackToken';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

const row = (key: string) => prisma.appConfig.findUnique({ where: { key } });

/** The stored row holds the secret encrypted, and the readers still get it back. */
async function expectStoredEncrypted(key: string, plaintext: string) {
  const stored = await row(key);
  expect(stored?.isEncrypted).toBe(true);
  expect(stored?.value).not.toContain(plaintext);
  expect(await getConfig(prisma, key, true)).toBe(plaintext);
}

/** Every audit row written for `key`, as text: what a reader of the log would see. */
async function auditTextFor(key: string) {
  const rows = await prisma.auditLog.findMany({ where: { targetId: key } });
  expect(rows.length).toBeGreaterThan(0);
  return JSON.stringify(rows.map(({ metadata }) => metadata));
}

describe('every writer stores a secret encrypted', () => {
  it('saveConfigs encrypts a secret written with encrypt: false', async () => {
    await saveConfigs(prisma, [{ key: TOKEN, value: SENTINEL, encrypt: false }]);

    await expectStoredEncrypted(TOKEN, SENTINEL);
  });

  it('leaves a non-secret plain when the caller does not ask', async () => {
    await saveConfigs(prisma, [{ key: 'app.name', value: 'Luke', encrypt: false }]);

    expect(await row('app.name')).toMatchObject({ value: 'Luke', isEncrypted: false });
  });

  it('config.set answers and audits the effective decision, not the flag', async () => {
    const caller = await createCallerAs('admin');

    const result = await caller.config.set({ key: TOKEN, value: SENTINEL, encrypt: false });

    await expectStoredEncrypted(TOKEN, SENTINEL);
    expect(result).toMatchObject({ value: CONFIG_SECRET_PLACEHOLDER, isEncrypted: true });
    const audit = await auditTextFor(TOKEN);
    expect(audit).not.toContain(SENTINEL);
    expect(audit).toContain('"isEncrypted":true');
  });

  it('config.importJson encrypts a secret the file marks as plaintext', async () => {
    const caller = await createCallerAs('admin');

    const result = await caller.config.importJson({ items: [{ key: TOKEN, value: SENTINEL, encrypt: false }] });

    expect(result.successCount).toBe(1);
    await expectStoredEncrypted(TOKEN, SENTINEL);
    expect(await auditTextFor(TOKEN)).not.toContain(SENTINEL);
  });

  it('the LDAP settings save encrypts the bind credentials', async () => {
    const caller = await createCallerAs('admin');

    await caller.integrations.auth.saveLdapConfig({
      enabled: true,
      url: 'ldap://dc.example.com:389',
      bindDN: 'cn=svc,dc=example,dc=com',
      bindPassword: SENTINEL,
      searchBase: 'dc=example,dc=com',
      searchFilter: '(uid={{username}})',
      groupSearchBase: '',
      groupSearchFilter: '',
      roleMapping: '',
      strategy: 'local-first',
    });

    await expectStoredEncrypted('auth.ldap.bindPassword', SENTINEL);
    expect((await row('auth.ldap.bindDN'))?.isEncrypted).toBe(true);
  });

  it('the seed creates every secret it writes encrypted', async () => {
    await prisma.appConfig.deleteMany();

    await seedAppConfigs(prisma);

    const seeded = await prisma.appConfig.findMany({ where: { key: { in: [...SECRET_CONFIG_KEYS] } } });
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.filter(({ isEncrypted }) => !isEncrypted).map(({ key }) => key)).toEqual([]);
  });
});

describe('db:encrypt-secret-config', () => {
  const NEXTAUTH = 'auth.nextAuthSecret';
  const NEXTAUTH_VALUE = 'a'.repeat(64);

  /** A plaintext secret as an older release stored it, next to rows the script must not touch. */
  async function legacyRows() {
    await prisma.appConfig.createMany({
      data: [
        { key: NEXTAUTH, value: NEXTAUTH_VALUE, isEncrypted: false },
        { key: 'app.name', value: 'Luke', isEncrypted: false },
        { key: 'smtp.pass', value: encryptValue('mail-pass'), isEncrypted: true },
      ],
    });
  }

  it('encrypts a plaintext secret row, audits it, and leaves every other row alone', async () => {
    await legacyRows();
    const storedPass = (await row('smtp.pass'))?.value;

    const report = await encryptPlainSecretRows(prisma);

    expect(report).toEqual({ encrypted: [NEXTAUTH], invalid: [], changedConcurrently: [], failed: [] });
    await expectStoredEncrypted(NEXTAUTH, NEXTAUTH_VALUE);
    expect(await row('app.name')).toMatchObject({ value: 'Luke', isEncrypted: false });
    expect((await row('smtp.pass'))?.value).toBe(storedPass);
    const audit = await auditTextFor(NEXTAUTH);
    expect(audit).toContain('"source":"cli"');
    expect(audit).not.toContain(NEXTAUTH_VALUE);
  });

  it('finds nothing to do on a second run', async () => {
    await legacyRows();
    await encryptPlainSecretRows(prisma);

    expect(await encryptPlainSecretRows(prisma)).toEqual({ encrypted: [], invalid: [], changedConcurrently: [], failed: [] });
  });

  it('changes nothing in a dry run', async () => {
    await legacyRows();

    const report = await encryptPlainSecretRows(prisma, { dryRun: true });

    expect(report.encrypted).toEqual([NEXTAUTH]);
    expect(await row(NEXTAUTH)).toMatchObject({ value: NEXTAUTH_VALUE, isEncrypted: false });
  });

  it('skips and reports a plaintext secret its schema refuses', async () => {
    await prisma.appConfig.create({ data: { key: NEXTAUTH, value: 'too-short', isEncrypted: false } });

    const report = await encryptPlainSecretRows(prisma);

    expect(report.encrypted).toEqual([]);
    expect(report.invalid).toEqual([{ key: NEXTAUTH, message: expect.any(String) }]);
    expect(report.invalid[0]?.message).not.toContain('too-short');
    expect(await row(NEXTAUTH)).toMatchObject({ value: 'too-short', isEncrypted: false });
  });

  it('refuses when the master key decrypts none of the rows already encrypted', async () => {
    await legacyRows();
    // Well-formed, but not encrypted with this process's key: a script run with another key.
    await prisma.appConfig.update({
      where: { key: 'smtp.pass' },
      data: { value: `${'0'.repeat(24)}:${'0'.repeat(32)}:00ff` },
    });

    await expect(encryptPlainSecretRows(prisma)).rejects.toBeInstanceOf(EncryptSecretsRefused);
    expect(await row(NEXTAUTH)).toMatchObject({ value: NEXTAUTH_VALUE, isEncrypted: false });
  });

  it('goes on when only some encrypted rows are under another key, as on a clone of another instance', async () => {
    await legacyRows();
    await prisma.appConfig.create({
      data: { key: 'auth.ldap.url', value: `${'0'.repeat(24)}:${'0'.repeat(32)}:00ff`, isEncrypted: true },
    });

    expect((await encryptPlainSecretRows(prisma)).encrypted).toEqual([NEXTAUTH]);
  });

  it('has nothing to check, and so nothing to refuse, when no secret is stored in plaintext', async () => {
    await prisma.appConfig.create({ data: { key: 'app.name', value: 'Luke', isEncrypted: false } });

    const report = await encryptPlainSecretRows(prisma, { masterKeyPath: '/nonexistent/.luke/secret.key' });

    expect(report.encrypted).toEqual([]);
  });

  it('refuses when there is no master key file, instead of creating one', async () => {
    await legacyRows();

    await expect(
      encryptPlainSecretRows(prisma, { masterKeyPath: '/nonexistent/.luke/secret.key' }),
    ).rejects.toBeInstanceOf(EncryptSecretsRefused);
    expect(await row(NEXTAUTH)).toMatchObject({ value: NEXTAUTH_VALUE, isEncrypted: false });
  });
});
