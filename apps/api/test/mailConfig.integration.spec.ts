/**
 * `integrations.mail.saveConfig` validates with the schema the settings form uses, and nothing it
 * accepts is refused by the registry halfway through the save.
 *
 * The procedure writes seven keys one `saveConfig` call at a time, and every call answers to
 * `AppConfigRegistry`. The router used to carry its own looser copy of the form schema while the
 * registry declared `smtp.from` as a bare `.email()`: the `Name <addr>` sender the form offers
 * passed the input, then failed at the fifth write, after host, port, secure and user had already
 * been overwritten.
 *
 * Every rejection case seeds known rows first and sends values that differ from them, so
 * "unchanged" cannot hide a write that happened.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import type { AppConfigKey } from '@luke/core';

import { getConfig, saveConfig } from '../src/lib/configManager';

import { setupTestDb, createCallerAs, expectToThrow } from './helpers';

const MAIL_KEYS: AppConfigKey[] = [
  'smtp.host',
  'smtp.port',
  'smtp.secure',
  'smtp.user',
  'smtp.pass',
  'smtp.from',
  'app.baseUrl',
];

const payload = {
  host: 'new-smtp.example.com',
  port: 587,
  secure: false,
  user: 'new-user',
  pass: 'new-pass',
  from: 'Luke <noreply@example.com>',
  baseUrl: 'https://luke.example.com',
};

describe('integrations.mail.saveConfig', () => {
  let testPrisma: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    testPrisma = await setupTestDb();

    await saveConfig(testPrisma, 'smtp.host', 'old-smtp.example.com');
    await saveConfig(testPrisma, 'smtp.port', '25');
    await saveConfig(testPrisma, 'smtp.secure', 'true');
    await saveConfig(testPrisma, 'smtp.user', 'old-user');
    await saveConfig(testPrisma, 'smtp.pass', 'old-pass', true);
    await saveConfig(testPrisma, 'smtp.from', 'old@example.com');
    await saveConfig(testPrisma, 'app.baseUrl', 'https://old.example.com');
  });

  /** The stored rows as they are, ciphertext included: a rewritten password changes its IV. */
  async function storedRows() {
    const rows = await testPrisma.appConfig.findMany({
      where: { key: { in: MAIL_KEYS } },
      select: { key: true, value: true },
      orderBy: { key: 'asc' },
    });
    expect(rows).toHaveLength(MAIL_KEYS.length);
    return rows;
  }

  it('stores a named sender along with every other key', async () => {
    const caller = await createCallerAs('admin');

    await caller.integrations.mail.saveConfig(payload);

    expect(await getConfig(testPrisma, 'smtp.host', false)).toBe('new-smtp.example.com');
    expect(await getConfig(testPrisma, 'smtp.port', false)).toBe('587');
    expect(await getConfig(testPrisma, 'smtp.secure', false)).toBe('false');
    expect(await getConfig(testPrisma, 'smtp.user', false)).toBe('new-user');
    expect(await getConfig(testPrisma, 'smtp.pass', true)).toBe('new-pass');
    expect(await getConfig(testPrisma, 'smtp.from', false)).toBe('Luke <noreply@example.com>');
    expect(await getConfig(testPrisma, 'app.baseUrl', false)).toBe('https://luke.example.com');
  });

  it('refuses a malformed sender before writing anything', async () => {
    const caller = await createCallerAs('admin');
    const before = await storedRows();

    await expectToThrow(
      caller.integrations.mail.saveConfig({ ...payload, from: 'not-an-email' }),
      { code: 'BAD_REQUEST' },
    );

    expect(await storedRows()).toEqual(before);
  });

  it('refuses a fractional or out-of-range port before writing anything', async () => {
    const caller = await createCallerAs('admin');
    const before = await storedRows();

    // The registry stores ports as integers; the router's copy had no `.int()`, so 587.5 passed
    // the input and failed at the second write, after the host had been replaced.
    await expectToThrow(caller.integrations.mail.saveConfig({ ...payload, port: 587.5 }), {
      code: 'BAD_REQUEST',
    });
    await expectToThrow(caller.integrations.mail.saveConfig({ ...payload, port: 70000 }), {
      code: 'BAD_REQUEST',
    });

    expect(await storedRows()).toEqual(before);
  });

  it('requires secure instead of defaulting it', async () => {
    const caller = await createCallerAs('admin');
    const { secure: _secure, ...withoutSecure } = payload;

    await expectToThrow(
      // @ts-expect-error — a caller that omits `secure`, which the form always sends
      caller.integrations.mail.saveConfig(withoutSecure),
      { code: 'BAD_REQUEST' },
    );
  });

  it('keeps the stored password when none is sent', async () => {
    const caller = await createCallerAs('admin');
    const { pass: _pass, ...withoutPass } = payload;

    await caller.integrations.mail.saveConfig(withoutPass);
    expect(await getConfig(testPrisma, 'smtp.pass', true)).toBe('old-pass');

    await caller.integrations.mail.saveConfig({ ...payload, pass: '' });
    expect(await getConfig(testPrisma, 'smtp.pass', true)).toBe('old-pass');
  });
});
