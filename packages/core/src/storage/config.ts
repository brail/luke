/**
 * @luke/core/storage - Configurazione storage
 *
 * Schema Zod per validazione configurazione storage providers
 *
 * @version 0.1.0
 * @author Luke Team
 */

import { z } from 'zod';

import type { StorageBucket } from './types';

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
   * Bucket abilitati
   * Default: ['uploads', 'exports', 'assets', 'brand-logos', 'collection-row-pictures', 'merchandising-specsheet-images']
   */
  buckets: z
    .array(
      z.enum([
        'uploads',
        'exports',
        'assets',
        'brand-logos',
        'collection-row-pictures',
        'merchandising-specsheet-images',
      ])
    )
    .default([
      'uploads',
      'exports',
      'assets',
      'brand-logos',
      'collection-row-pictures',
      'merchandising-specsheet-images',
    ]),

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
 * Schema per configurazione MinIO (S3-compatible)
 */
export const minioStorageConfigSchema = z.object({
  endpoint: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(9000),
  useSSL: z.boolean().default(false),
  accessKey: z.string().min(1),
  secretKey: z.string().min(1),
  region: z.string().default('us-east-1'),
  /** Public base URL for public-read buckets (e.g. https://minio.example.com) */
  publicBaseUrl: z.string().url().optional(),
  /** TTL in seconds for presigned PUT URLs */
  presignedPutTtl: z.number().int().min(60).max(86400).default(3600),
  /** TTL in seconds for presigned GET URLs */
  presignedGetTtl: z.number().int().min(60).max(86400).default(3600),
});

export type MinioStorageConfig = z.infer<typeof minioStorageConfigSchema>;

/**
 * Schema per tipo di storage (estensibile per futuri provider)
 */
export const storageTypeSchema = z.enum(['local', 'minio']);

/**
 * Tipo per identificare il provider di storage
 */
export type StorageType = z.infer<typeof storageTypeSchema>;

/**
 * Helper per validare bucket
 */
export function isValidBucket(bucket: string): bucket is StorageBucket {
  return [
    'uploads',
    'exports',
    'assets',
    'brand-logos',
    'collection-row-pictures',
    'merchandising-specsheet-images',
  ].includes(bucket);
}
