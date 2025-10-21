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
   * Default: ['uploads', 'exports', 'assets']
   */
  buckets: z
    .array(z.enum(['uploads', 'exports', 'assets']))
    .default(['uploads', 'exports', 'assets']),
});

/**
 * Tipo inferito per configurazione storage locale
 */
export type LocalStorageConfig = z.infer<typeof localStorageConfigSchema>;

/**
 * Schema per tipo di storage (estensibile per futuri provider)
 */
export const storageTypeSchema = z.enum(['local', 'samba', 'gdrive']);

/**
 * Tipo per identificare il provider di storage
 */
export type StorageType = z.infer<typeof storageTypeSchema>;

/**
 * Helper per validare bucket
 */
export function isValidBucket(bucket: string): bucket is StorageBucket {
  return ['uploads', 'exports', 'assets'].includes(bucket);
}



