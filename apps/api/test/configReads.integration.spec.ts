/**
 * Every AppConfig read decrypts, and nothing it reports carries a stored value.
 *
 * `getConfig` used to take a `decrypt` flag, and the default readers read without decrypting: a
 * key stored encrypted came back as ciphertext, which the registry refused, so the reader fell back
 * to the default with a warning — or, for the strict reader, called the row invalid. A presence
 * check of a secret read its ciphertext just to test it for truth. Now every read decrypts, a
 * decryption error propagates instead of turning into a default, presence has its own read that
 * returns no value, and an invalid stored value is reported by key.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import type { PrismaClient } from '@luke/db';

import {
  InvalidStoredConfigError,
  getBackupScheduleSettings,
  getConfigOrDefault,
  getStoredConfigOrDefault,
  saveConfigs,
} from '../src/lib/configManager';
import { getMaintenanceState } from '../src/lib/maintenanceMode';

import { setupTestDb } from './helpers';

/** Well-formed (`iv:authTag:ciphertext`), but encrypted with no key this process holds. */
const FOREIGN_CIPHERTEXT = `${'0'.repeat(24)}:${'0'.repeat(32)}:00ff`;

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

describe('the readers decrypt', () => {
  it('getConfigOrDefault reads a key stored encrypted, not its default', async () => {
    await saveConfigs(prisma, [{ key: 'storage.local.maxFileSizeMB', value: '77', encrypt: true }]);

    expect(await getConfigOrDefault(prisma, 'storage.local.maxFileSizeMB')).toBe(77);
  });

  it('getStoredConfigOrDefault reads a key stored encrypted instead of calling it invalid', async () => {
    await saveConfigs(prisma, [{ key: 'storage.type', value: 's3', encrypt: true }]);

    expect(await getStoredConfigOrDefault(prisma, 'storage.type')).toBe('s3');
  });

  it('a value that does not decrypt is an error, not the default', async () => {
    await prisma.appConfig.create({
      data: { key: 'storage.local.maxFileSizeMB', value: FOREIGN_CIPHERTEXT, isEncrypted: true },
    });

    await expect(getConfigOrDefault(prisma, 'storage.local.maxFileSizeMB')).rejects.toThrow();
  });
});

describe('an invalid stored value is reported by key', () => {
  it('InvalidStoredConfigError names the key and carries no value', async () => {
    await prisma.appConfig.create({ data: { key: 'storage.type', value: 'minio-sentinel', isEncrypted: false } });

    const error = await getStoredConfigOrDefault(prisma, 'storage.type').catch((e: unknown) => e);

    if (!(error instanceof InvalidStoredConfigError)) throw new Error('expected an InvalidStoredConfigError');
    expect(error.key).toBe('storage.type');
    expect(error.message).not.toContain('minio-sentinel');
    expect(JSON.stringify(error)).not.toContain('minio-sentinel');
  });

  it('the backup schedule reports an invalid scope without its stored value', async () => {
    await prisma.appConfig.create({
      data: { key: 'backup.schedule.scope', value: 'scope-sentinel', isEncrypted: false },
    });

    const settings = await getBackupScheduleSettings(prisma);

    expect(settings.scope).toBeNull();
    expect(JSON.stringify(settings)).not.toContain('scope-sentinel');
  });
});

describe('a row that does not decrypt, where a fallback is the documented answer', () => {
  it('maintenance mode reads it as inactive, as any corrupt state', async () => {
    // The only read of the state in this file: the module's 5-second cache is empty.
    await prisma.appConfig.create({ data: { key: 'maintenance.mode.state', value: FOREIGN_CIPHERTEXT, isEncrypted: true } });

    expect((await getMaintenanceState(prisma)).status).toBe('INACTIVE');
  });

  it('the backup schedule reports the scope as invalid, so the scheduler skips and notifies', async () => {
    await prisma.appConfig.create({ data: { key: 'backup.schedule.scope', value: FOREIGN_CIPHERTEXT, isEncrypted: true } });

    expect((await getBackupScheduleSettings(prisma)).scope).toBeNull();
  });
});
