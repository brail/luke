/**
 * The S3 secret key never leaves the API. The settings page learns only whether one is stored, and
 * a save that leaves the field blank keeps it — the `hasPassword` pattern of the mail and NAV forms,
 * closing the case ADR-023 left open for `storage.getConfig`. With no secret stored, a blank one is
 * refused instead of saving an S3 configuration that cannot connect.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import { getConfig } from '../src/lib/configManager';

import { setupTestDb, createCallerAs } from './helpers';

const S3 = {
  type: 's3' as const,
  endpoint: 's3.example.com',
  port: 9000,
  useSSL: true,
  accessKey: 'ak',
  region: 'eu',
  publicBaseUrl: '',
  presignedPutTtl: 300,
  presignedGetTtl: 300,
};

describe('storage S3 secret key', () => {
  let testPrisma: Awaited<ReturnType<typeof setupTestDb>>;

  beforeEach(async () => {
    testPrisma = await setupTestDb();
    await testPrisma.appConfig.deleteMany({ where: { key: { startsWith: 'storage.' } } });
    vi.spyOn(await import('../src/storage'), 'resetStorageProvider').mockImplementation(() => undefined);
  });

  it('reports whether a secret is stored, never the secret', async () => {
    const caller = await createCallerAs('admin');
    expect((await caller.storage.getConfig()).s3).toMatchObject({ hasSecretKey: false });

    await caller.storage.saveConfig({ ...S3, secretKey: 'sk-stored' });
    const s3 = (await caller.storage.getConfig()).s3;

    expect(s3.hasSecretKey).toBe(true);
    expect(s3).not.toHaveProperty('secretKey');
    expect(JSON.stringify(s3)).not.toContain('sk-stored');
  });

  it.each([
    ['left blank', { secretKey: '' }],
    ['left out', {}],
  ])('keeps the stored secret when the field is %s', async (_, secret) => {
    const caller = await createCallerAs('admin');
    await caller.storage.saveConfig({ ...S3, secretKey: 'sk-stored' });

    await caller.storage.saveConfig({ ...S3, region: 'us', ...secret });

    expect(await getConfig(testPrisma, 'storage.s3.secretKey', true)).toBe('sk-stored');
    expect((await caller.storage.getConfig()).s3.region).toBe('us');
  });

  it('replaces the stored secret with a new one', async () => {
    const caller = await createCallerAs('admin');
    await caller.storage.saveConfig({ ...S3, secretKey: 'sk-stored' });

    await caller.storage.saveConfig({ ...S3, secretKey: 'sk-new' });

    expect(await getConfig(testPrisma, 'storage.s3.secretKey', true)).toBe('sk-new');
  });

  it('refuses a blank secret when none is stored, and writes nothing', async () => {
    const caller = await createCallerAs('admin');

    await expect(caller.storage.saveConfig({ ...S3, secretKey: '' })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    });
    expect(await getConfig(testPrisma, 'storage.type', false)).toBeNull();
    expect(await getConfig(testPrisma, 'storage.s3.accessKey', false)).toBeNull();
  });
});
