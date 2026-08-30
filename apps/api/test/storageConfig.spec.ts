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

import {
  AppConfigRegistry,
  localStorageConfigSchema,
  localStorageSaveConfigSchema,
  s3StorageConfigSchema,
  s3StorageSaveConfigSchema,
  storageTypeSchema,
} from '@luke/core';

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

/**
 * Terza dichiarazione degli stessi campi: `storage.saveConfig` prende i `*SaveConfigSchema`, che
 * ripetono i `*ConfigSchema` senza i `.default()` (un save deve dichiarare ogni valore che scrive).
 * Il guardiano sopra copriva due sorgenti su tre — un campo aggiunto allo schema base e non a
 * quello di salvataggio resta semplicemente non impostabile dal form, in silenzio.
 */
describe('Sincronia fra gli schema di salvataggio e quelli base', () => {
  const drop = (shape: object, ...omit: string[]) =>
    Object.keys(shape).filter(k => !omit.includes(k));

  it('s3StorageSaveConfigSchema copre esattamente i campi di s3StorageConfigSchema', () => {
    expect(drop(s3StorageSaveConfigSchema.shape, 'type').sort()).toEqual(
      drop(s3StorageConfigSchema.shape).sort()
    );
  });

  // `localStorageConfigSchema` non è il termine di paragone giusto: descrive ciò che serve al
  // provider (basePath, maxFileSizeMB), non ciò che il form scrive. Le chiavi `storage.local.*` del
  // registry sì — sono esattamente quelle che `saveConfig` tocca.
  const registryLocalKeys = Object.keys(AppConfigRegistry)
    .filter(key => key.startsWith('storage.local.'))
    .map(key => key.replace('storage.local.', ''));

  it('ogni campo di localStorageSaveConfigSchema ha la sua chiave storage.local.* nel registry', () => {
    const extra = drop(localStorageSaveConfigSchema.shape, 'type').filter(k => !registryLocalKeys.includes(k));
    expect(extra).toEqual([]);
  });

  it('solo publicBaseUrl resta una chiave storage.local.* che il form non può impostare', () => {
    // Non una scelta: nessun controllo lo espone, e `lib/storageUrl.ts` lo legge. Se questo elenco
    // cresce, qualcuno ha aggiunto una chiave configurabile che nessuno può configurare.
    const save = drop(localStorageSaveConfigSchema.shape, 'type');
    expect(registryLocalKeys.filter(k => !save.includes(k))).toEqual(['publicBaseUrl']);
  });

  // Il registry non validava il tetto, quindi un valore che il provider rifiuta all'init si
  // scriveva pulito e si scopriva solo quando ogni operazione di storage smetteva di funzionare.
  it('registry e schema concordano sul tetto di maxFileSizeMB', () => {
    const registry = AppConfigRegistry['storage.local.maxFileSizeMB'];
    expect(registry.safeParse('1000').success).toBe(true);
    expect(registry.safeParse('5000').success).toBe(false);
    expect(localStorageConfigSchema.safeParse({ basePath: '/x', maxFileSizeMB: 5000 }).success).toBe(false);
    expect(localStorageSaveConfigSchema.safeParse({
      type: 'local', basePath: '/x', maxFileSizeMB: 5000, enableProxy: true,
    }).success).toBe(false);
  });
});
