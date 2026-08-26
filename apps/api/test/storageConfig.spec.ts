/**
 * Sincronia fra le definizioni storage duplicate a mano.
 *
 * `storage.type` e i 9 campi `storage.s3.*` sono dichiarati due volte:
 * una volta come `storageTypeSchema`/`s3StorageConfigSchema` (packages/core/src/storage/config.ts,
 * usati per validare AppConfig letto/scritto dai provider) e una volta come voci
 * separate di `AppConfigRegistry` (packages/core/src/schemas/config.ts, usate da
 * `validateCriticalConfig()` e dal tRPC config router). Stesso pattern di rischio
 * documentato in lessons.md per RATE_LIMIT_CONFIG/RATE_LIMIT_POLICY_DEFAULTS/
 * RateLimitConfigSchema (hotfix v1.9.1): un campo aggiunto a una sola fonte non è
 * un errore di compilazione, è un drift silenzioso.
 *
 * Unit tier: solo confronto fra Zod schema, nessun DB.
 */

import { describe, it, expect } from 'vitest';

import { AppConfigRegistry, s3StorageConfigSchema, storageTypeSchema } from '@luke/core';

describe('Sincronia storage.type fra storageTypeSchema e AppConfigRegistry', () => {
  it('AppConfigRegistry accetta esattamente gli stessi valori di storageTypeSchema', () => {
    const registrySchema = AppConfigRegistry['storage.type'];
    // Entrambi sono z.enum(['local', 's3']) — confronta i valori accettati, non le istanze.
    expect(registrySchema.options).toEqual(storageTypeSchema.options);
  });
});

describe('Sincronia campi storage.s3.* fra S3StorageConfigSchema e AppConfigRegistry', () => {
  const schemaFields = Object.keys(s3StorageConfigSchema.shape);
  const registryS3Keys = Object.keys(AppConfigRegistry)
    .filter(key => key.startsWith('storage.s3.'))
    .map(key => key.replace('storage.s3.', ''));

  it('ogni campo di S3StorageConfigSchema ha una chiave storage.s3.<campo> in AppConfigRegistry', () => {
    const missing = schemaFields.filter(field => !registryS3Keys.includes(field));
    expect(missing).toEqual([]);
  });

  it('AppConfigRegistry non ha chiavi storage.s3.* orfane, senza campo corrispondente nello schema', () => {
    const extra = registryS3Keys.filter(key => !schemaFields.includes(key));
    expect(extra).toEqual([]);
  });
});
