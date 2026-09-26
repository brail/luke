/**
 * Consistency between the hand-duplicated storage definitions.
 *
 * `storage.type` and the 9 `storage.s3.*` fields are declared twice:
 * once as `storageTypeSchema`/`s3StorageConfigSchema` (packages/core/src/storage/config.ts,
 * used to validate the AppConfig the providers read and write) and once as separate
 * `AppConfigRegistry` entries (packages/core/src/schemas/config.ts, used by
 * `validateCriticalConfig()` and the tRPC config router). Same risk pattern as the one
 * documented in lessons.md for RATE_LIMIT_CONFIG/RATE_LIMIT_POLICY_DEFAULTS/
 * RateLimitConfigSchema (hotfix v1.9.1): a field added to only one source is not
 * a compile error, it is silent drift.
 *
 * Unit tier: Zod schemas compared only, no DB.
 */

import { describe, it, expect } from 'vitest';

import {
  AppConfigRegistry,
  localStorageConfigSchema,
  localStorageSaveConfigSchema,
  s3StorageConfigSchema,
  s3StorageSaveConfigSchema,
  storageTypeSchema,
} from '@luke/core';

describe('storage.type consistency between storageTypeSchema and AppConfigRegistry', () => {
  it('AppConfigRegistry accepts exactly the same values as storageTypeSchema', () => {
    const registrySchema = AppConfigRegistry['storage.type'];
    // Both are z.enum(['local', 's3']) — compare the accepted values, not the instances.
    expect(registrySchema.options).toEqual(storageTypeSchema.options);
  });
});

describe('storage.s3.* field consistency between S3StorageConfigSchema and AppConfigRegistry', () => {
  const schemaFields = Object.keys(s3StorageConfigSchema.shape);
  const registryS3Keys = Object.keys(AppConfigRegistry)
    .filter(key => key.startsWith('storage.s3.'))
    .map(key => key.replace('storage.s3.', ''));

  it('every S3StorageConfigSchema field has a storage.s3.<field> key in AppConfigRegistry', () => {
    const missing = schemaFields.filter(field => !registryS3Keys.includes(field));
    expect(missing).toEqual([]);
  });

  it('AppConfigRegistry has no orphan storage.s3.* keys without a matching schema field', () => {
    const extra = registryS3Keys.filter(key => !schemaFields.includes(key));
    expect(extra).toEqual([]);
  });
});

/**
 * A third declaration of the same fields: `storage.saveConfig` takes the `*SaveConfigSchema`, which
 * repeat the `*ConfigSchema` without the `.default()` (a save must declare every value it writes).
 * The guard above covered two sources out of three — a field added to the base schema and not to
 * the save one simply stays unsettable from the form, silently.
 */
describe('Consistency between the save schemas and the base ones', () => {
  const drop = (shape: object, ...omit: string[]) =>
    Object.keys(shape).filter(k => !omit.includes(k));

  it('s3StorageSaveConfigSchema covers exactly the fields of s3StorageConfigSchema', () => {
    expect(drop(s3StorageSaveConfigSchema.shape, 'type').sort()).toEqual(
      drop(s3StorageConfigSchema.shape).sort()
    );
  });

  // `localStorageConfigSchema` is not the right yardstick: it describes what the provider needs
  // (basePath, maxFileSizeMB), not what the form writes. The registry's `storage.local.*` keys
  // are — they are exactly the ones `saveConfig` touches.
  const registryLocalKeys = Object.keys(AppConfigRegistry)
    .filter(key => key.startsWith('storage.local.'))
    .map(key => key.replace('storage.local.', ''));

  it('every localStorageSaveConfigSchema field has its storage.local.* key in the registry', () => {
    const extra = drop(localStorageSaveConfigSchema.shape, 'type').filter(k => !registryLocalKeys.includes(k));
    expect(extra).toEqual([]);
  });

  it('only publicBaseUrl stays a storage.local.* key the form cannot set', () => {
    // Not a choice: no control exposes it, and `lib/storageUrl.ts` reads it. If this list
    // grows, someone added a configurable key nobody can configure.
    const save = drop(localStorageSaveConfigSchema.shape, 'type');
    expect(registryLocalKeys.filter(k => !save.includes(k))).toEqual(['publicBaseUrl']);
  });

  // The registry did not validate the cap, so a value the provider rejects at init was written
  // cleanly and only discovered when every storage operation stopped working.
  it('registry and schema agree on the maxFileSizeMB cap', () => {
    const registry = AppConfigRegistry['storage.local.maxFileSizeMB'];
    expect(registry.safeParse('1000').success).toBe(true);
    expect(registry.safeParse('5000').success).toBe(false);
    expect(localStorageConfigSchema.safeParse({ basePath: '/x', maxFileSizeMB: 5000 }).success).toBe(false);
    expect(localStorageSaveConfigSchema.safeParse({
      type: 'local', basePath: '/x', maxFileSizeMB: 5000, enableProxy: true,
    }).success).toBe(false);
  });
});
