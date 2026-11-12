/**
 * A config write that does not say whether to encrypt keeps the stored choice (#236). Every input
 * schema used to default `encrypt` to `false`, and `saveConfigs` read an absent flag as plaintext, so
 * a key an admin chose to encrypt — not a secret, which the registry always encrypts — was silently
 * stored in plaintext by the next save that did not mention it: `config.update`, or a settings form.
 *
 * The choice is read under the AppConfig write lock, which `deleteConfig` takes too: the races below
 * hold it on a connection of their own and change the row while the real writer waits.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { CONFIG_SECRET_PLACEHOLDER } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { deleteConfig, encryptValue, getConfig, saveConfig, saveConfigs } from '../src/lib/configManager';

import { createCallerAs, setupTestDb } from './helpers';
import { whileHeld } from './helpers/heldTransaction';

import type { Client } from 'pg';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

/** A key neither secret nor plaintext-only: encrypted only when someone asks. */
const KEY = 'app.name';

const stored = async (key: string = KEY) =>
  (await prisma.appConfig.findUnique({ where: { key }, select: { isEncrypted: true } }))?.isEncrypted;

const lastUpsertAudit = (key: string = KEY) =>
  prisma.auditLog.findFirstOrThrow({
    where: { action: 'CONFIG_UPSERT', targetId: key },
    orderBy: { createdAt: 'desc' },
  });

describe('an omitted encrypt keeps the stored choice', () => {
  it('config.update keeps an encrypted key encrypted, and says so', async () => {
    await saveConfig(prisma, KEY, 'Before', true);
    const caller = await createCallerAs('admin');

    const result = await caller.config.update({ key: KEY, value: 'After' });

    expect(await stored()).toBe(true);
    expect(await getConfig(prisma, KEY)).toBe('After');
    expect(result).toMatchObject({ isEncrypted: true, value: CONFIG_SECRET_PLACEHOLDER });
    expect((await lastUpsertAudit()).metadata).toMatchObject({ isEncrypted: true, valueRedacted: CONFIG_SECRET_PLACEHOLDER });
  });

  it('config.set keeps a plaintext key plaintext, and a new key is plaintext', async () => {
    const caller = await createCallerAs('admin');
    await prisma.appConfig.deleteMany({ where: { key: KEY } });

    await expect(caller.config.set({ key: KEY, value: 'New' })).resolves.toMatchObject({ isEncrypted: false });
    expect(await stored()).toBe(false);
    await caller.config.set({ key: KEY, value: 'Again' });
    expect(await stored()).toBe(false);
  });

  it('config.setMultiple keeps the stored choice per item', async () => {
    await saveConfig(prisma, KEY, 'Before', true);
    const caller = await createCallerAs('admin');

    await caller.config.setMultiple({ configs: [{ key: KEY, value: 'After' }] });

    expect(await stored()).toBe(true);
    expect(await getConfig(prisma, KEY)).toBe('After');
  });

  it('a settings form that does not mention encryption keeps an encrypted field encrypted', async () => {
    await saveConfig(prisma, 'smtp.host', 'old.example.com', true);
    const caller = await createCallerAs('admin');

    await caller.integrations.mail.saveConfig({
      host: 'new.example.com', port: 587, secure: false, user: 'user', pass: '',
      from: 'Luke <noreply@example.com>', baseUrl: 'https://luke.example.com',
    });

    expect(await stored('smtp.host')).toBe(true);
    expect(await getConfig(prisma, 'smtp.host')).toBe('new.example.com');
    expect(await stored('smtp.port')).toBe(false);
  });
});

describe('config.update of a key that is not stored', () => {
  it('answers NOT_FOUND and writes nothing', async () => {
    await prisma.appConfig.deleteMany({ where: { key: KEY } });
    const caller = await createCallerAs('admin');

    await expect(caller.config.update({ key: KEY, value: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await stored()).toBeUndefined();
  });

  it('the kill switch too, through its own writer', async () => {
    await prisma.appConfig.deleteMany({ where: { key: 'app.sections.disabled' } });
    const caller = await createCallerAs('admin');

    await expect(caller.config.update({ key: 'app.sections.disabled', value: '[]' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await stored('app.sections.disabled')).toBeUndefined();
  });
});

describe('an explicit encrypt still decides', () => {
  it('false decrypts an encrypted key, true encrypts a plaintext one', async () => {
    const caller = await createCallerAs('admin');
    await saveConfig(prisma, KEY, 'Before', true);

    await expect(caller.config.update({ key: KEY, value: 'Plain', encrypt: false })).resolves.toMatchObject({ isEncrypted: false });
    expect(await stored()).toBe(false);
    await expect(caller.config.update({ key: KEY, value: 'Secret', encrypt: true })).resolves.toMatchObject({ isEncrypted: true });
    expect(await stored()).toBe(true);
  });

  it('the kill switch stays plaintext with its own audit row', async () => {
    const caller = await createCallerAs('admin');

    await expect(caller.config.set({ key: 'app.sections.disabled', value: '[]', encrypt: true })).resolves.toMatchObject({ isEncrypted: false });
    expect(await stored('app.sections.disabled')).toBe(false);
    expect((await lastUpsertAudit('app.sections.disabled')).metadata).toMatchObject({ key: 'app.sections.disabled' });
  });

  it('an import without a flag still means plaintext: the file format says so', async () => {
    await saveConfig(prisma, KEY, 'Before', true);
    const caller = await createCallerAs('admin');

    await caller.config.importJson({ items: [{ key: KEY, value: 'Imported' }] });
    expect(await stored()).toBe(false);
    await saveConfig(prisma, KEY, 'Before', true);
    await caller.config.importJson({ items: [{ key: KEY, value: 'Imported', encrypt: null }] });
    expect(await stored()).toBe(false);
  });
});

describe('a batch decides each write as the key stands at that point', () => {
  it('an explicit choice earlier in the batch is kept by a later write without one', async () => {
    await saveConfig(prisma, KEY, 'Before', false);

    const saved = await saveConfigs(prisma, [
      { key: KEY, value: 'First', encrypt: true },
      { key: KEY, value: 'Second' },
    ]);

    expect(saved).toEqual([true, true]);
    expect(await stored()).toBe(true);
    expect(await getConfig(prisma, KEY)).toBe('Second');
  });

  it.each([
    ['earlier in the same batch', () => saveConfigs(prisma, [{ key: KEY, value: null }, { key: KEY, value: 'Fresh' }])],
    ['by deleteConfig', async () => {
      await deleteConfig({ prisma }, KEY);
      await saveConfig(prisma, KEY, 'Fresh');
    }],
  ])('a key deleted %s and written again without a flag is a new key: plaintext', async (_, deleteThenWrite) => {
    await saveConfig(prisma, KEY, 'Before', true);

    await deleteThenWrite();

    expect(await stored()).toBe(false);
  });
});

describe('the choice read holds until the write commits', () => {
  const holdWriteLock = (holder: Client) =>
    holder.query(`SELECT pg_advisory_xact_lock(hashtext('app-config-write'))`);
  /** What a concurrent writer leaves while the real one waits: the key stored encrypted. */
  const storeEncrypted = (holder: Client) =>
    holder.query(
      `INSERT INTO app_configs (id, key, value, "isEncrypted", "updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, true, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "isEncrypted" = true, "updatedAt" = now()`,
      [KEY, encryptValue('Concurrent')]
    );

  it.each([
    ['stored in plaintext', true],
    ['absent', false],
  ])('a write without a flag waits, then keeps the encryption committed meanwhile (key %s)', async (_, present) => {
    if (present) await saveConfig(prisma, KEY, 'Before', false);
    else await prisma.appConfig.deleteMany({ where: { key: KEY } });

    const outcome = await whileHeld(holdWriteLock, () => saveConfig(prisma, KEY, 'Mine'), storeEncrypted);

    expect(outcome).toEqual({ status: 'fulfilled', value: true });
    expect(await stored()).toBe(true);
    expect(await getConfig(prisma, KEY)).toBe('Mine');
  });

  it('a write with an explicit flag waits on the same lock', async () => {
    const outcome = await whileHeld(holdWriteLock, () => saveConfig(prisma, KEY, 'Mine', false), storeEncrypted);

    expect(outcome).toEqual({ status: 'fulfilled', value: false });
    expect(await stored()).toBe(false);
  });

  it('an update waits, and a delete committed meanwhile makes it NOT_FOUND instead of a create', async () => {
    await saveConfig(prisma, KEY, 'Before', true);
    const caller = await createCallerAs('admin');

    const outcome = await whileHeld(
      holdWriteLock,
      () => caller.config.update({ key: KEY, value: 'Mine' }),
      holder => holder.query('DELETE FROM app_configs WHERE key = $1', [KEY])
    );

    expect(outcome).toMatchObject({ status: 'rejected', reason: { code: 'NOT_FOUND' } });
    expect(await stored()).toBeUndefined();
  });

  it('a delete waits on the same lock', async () => {
    await saveConfig(prisma, KEY, 'Before', true);

    const outcome = await whileHeld(holdWriteLock, () => deleteConfig({ prisma }, KEY));

    expect(outcome).toEqual({ status: 'fulfilled', value: true });
    expect(await stored()).toBeUndefined();
  });
});
