/**
 * @luke/core/storage — Zod schemas for storage provider configuration.
 * Covers local filesystem and S3-compatible providers (MinIO, SeaweedFS, Ceph RGW, ...).
 */

import { z } from 'zod';

import { APP_STORAGE_BUCKETS, type StorageBucket } from './types';

/**
 * Schema per configurazione storage locale (filesystem)
 */
export const localStorageConfigSchema = z.object({
  /**
   * Path base dove salvare i file
   * Esempio: /var/lib/luke/storage
   * Default: /tmp/luke-storage (solo per dev)
   */
  basePath: z.string().min(1),

  /**
   * Dimensione massima file in MB
   * Default: 50 MB
   * Range: 1-1000 MB
   */
  maxFileSizeMB: z.number().int().positive().min(1).max(1000).default(50),

  /**
   * URL base pubblico per accesso diretto ai file
   * Esempio: http://localhost:3001 (DEV) o https://api.example.com (PROD)
   * Opzionale: se non fornito, usa proxy Next.js
   */
  publicBaseUrl: z.string().url().optional(),

  /**
   * Abilita proxy Next.js per file serving
   * Default: true (DEV), false (PROD)
   * Se true, genera URL /api/uploads/... invece di URL assoluti
   */
  enableProxy: z.boolean().default(true),
});

/**
 * Tipo inferito per configurazione storage locale
 */
export type LocalStorageConfig = z.infer<typeof localStorageConfigSchema>;

/**
 * Schema per configurazione storage S3-compatible (MinIO, SeaweedFS, Ceph RGW, ...)
 */
export const s3StorageConfigSchema = z.object({
  endpoint: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(8333),
  useSSL: z.boolean().default(false),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  region: z.string().default('us-east-1'),
  /** Public base URL for public-read buckets (e.g. https://s3.example.com) */
  publicBaseUrl: z.string().url().optional(),
  /** TTL in seconds for presigned PUT URLs */
  presignedPutTtl: z.number().int().min(60).max(86400).default(3600),
  /** TTL in seconds for presigned GET URLs */
  presignedGetTtl: z.number().int().min(60).max(86400).default(3600),
});

export type S3StorageConfig = z.infer<typeof s3StorageConfigSchema>;

/**
 * What `storage.saveConfig` accepts for a local provider.
 *
 * Deliberately separate from `localStorageConfigSchema`: that one parses what is already in
 * AppConfig and lets `.default()` fill the gaps, while a save has to state every value it writes —
 * an omitted field there would mean "reset to default", which is never what a settings form means.
 *
 * `basePath` must be absolute or `~`-relative. A relative path resolves against whatever directory
 * the API process happens to have started in, which is not a configuration anyone means to write;
 * the settings form has always refused one, the endpoint used to accept it.
 */
export const localStorageSaveConfigSchema = z.object({
  type: z.literal('local'),
  basePath: z
    .string()
    .min(1, 'Path richiesto')
    .regex(/^(\/|~\/)[a-zA-Z0-9_./-]*$/, 'Path deve iniziare con / oppure ~/'),
  maxFileSizeMB: z.number().int().positive().min(1).max(1000),
  enableProxy: z.boolean().optional(),
});

/** What `storage.saveConfig` accepts for an S3-compatible provider. */
export const s3StorageSaveConfigSchema = z.object({
  type: z.literal('s3'),
  endpoint: z.string().min(1, 'Endpoint richiesto'),
  port: z.number().int().min(1).max(65535),
  useSSL: z.boolean(),
  accessKey: z.string().min(1, 'Access key richiesta'),
  secretKey: z.string().min(1, 'Secret key richiesta'),
  region: z.string().min(1, 'Region richiesta'),
  publicBaseUrl: z.string().url('URL non valido').or(z.literal('')).optional(),
  presignedPutTtl: z.number().int().min(60).max(86400),
  presignedGetTtl: z.number().int().min(60).max(86400),
});

/** The `storage.saveConfig` input. */
export const storageSaveConfigSchema = z.discriminatedUnion('type', [
  localStorageSaveConfigSchema,
  s3StorageSaveConfigSchema,
]);
export type StorageSaveConfig = z.infer<typeof storageSaveConfigSchema>;

/**
 * Schema per tipo di storage (estensibile per futuri provider)
 */
export const storageTypeSchema = z.enum(['local', 's3']);

/**
 * Tipo per identificare il provider di storage
 */
export type StorageType = z.infer<typeof storageTypeSchema>;

/**
 * Returns `true` if `bucket` is a recognized `StorageBucket` value.
 * Use before constructing storage paths to avoid runtime errors from typos.
 */
export function isValidBucket(bucket: string): bucket is StorageBucket {
  return ([...APP_STORAGE_BUCKETS, 'backups'] as readonly string[]).includes(bucket);
}
