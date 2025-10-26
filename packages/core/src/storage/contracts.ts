/**
 * @luke/core/storage - Contratti per URL generation e gestione storage
 *
 * Funzioni condivise per generazione URL pubblici, parsing e utilities
 * per mantenere coerenza tra frontend e backend.
 *
 * @version 0.1.0
 * @author Luke Team
 */

import type { StorageBucket } from './types';
import type { LocalStorageConfig } from './config';

/**
 * Configurazione per URL generation
 */
export interface UrlConfig {
  /** URL base del backend (es. http://localhost:3001) */
  publicBaseUrl?: string;
  /** Se abilitare proxy Next.js per file serving */
  enableProxy?: boolean;
  /** URL base del frontend per proxy (es. http://localhost:3000) */
  frontendBaseUrl?: string;
}

/**
 * Genera URL pubblico per un file nello storage
 *
 * @param bucket - Bucket del file
 * @param key - Chiave del file
 * @param config - Configurazione URL
 * @returns URL pubblico per accesso al file
 *
 * @example
 * // Proxy enabled (DEV)
 * getPublicUrl('brand-logos', '2025/01/15/uuid.png', { enableProxy: true })
 * // → '/api/uploads/brand-logos/2025/01/15/uuid.png'
 *
 * @example
 * // Direct backend (PROD)
 * getPublicUrl('brand-logos', '2025/01/15/uuid.png', {
 *   enableProxy: false,
 *   publicBaseUrl: 'https://api.example.com'
 * })
 * // → 'https://api.example.com/uploads/brand-logos/2025/01/15/uuid.png'
 */
export function getPublicUrl(
  bucket: StorageBucket,
  key: string,
  config: UrlConfig = {}
): string {
  const { enableProxy = true, publicBaseUrl, frontendBaseUrl } = config;

  // Sanitizza key per sicurezza
  const sanitizedKey = sanitizeKey(key);

  if (enableProxy) {
    // Usa proxy Next.js (DEV o quando configurato)
    return `/api/uploads/${bucket}/${sanitizedKey}`;
  } else {
    // Usa backend diretto (PROD)
    if (!publicBaseUrl) {
      throw new Error('publicBaseUrl required when proxy is disabled');
    }
    return `${publicBaseUrl}/uploads/${bucket}/${sanitizedKey}`;
  }
}

/**
 * Genera URL per proxy (sempre relativo al frontend)
 *
 * @param bucket - Bucket del file
 * @param key - Chiave del file
 * @returns URL proxy relativo
 */
export function getProxyUrl(bucket: StorageBucket, key: string): string {
  const sanitizedKey = sanitizeKey(key);
  return `/api/uploads/${bucket}/${sanitizedKey}`;
}

/**
 * Costruisce endpoint per upload backend
 *
 * @param entity - Tipo di entità (es. 'brand-logo')
 * @param id - ID dell'entità (opzionale per upload temporanei)
 * @returns Endpoint completo per upload
 *
 * @example
 * buildUploadEndpoint('brand-logo', 'brand-123')
 * // → '/upload/brand-logo/brand-123'
 *
 * @example
 * buildUploadEndpoint('brand-logo')
 * // → '/upload/brand-logo/temp'
 */
export function buildUploadEndpoint(entity: string, id?: string): string {
  const sanitizedEntity = sanitizeEntityName(entity);

  if (id) {
    const sanitizedId = sanitizeId(id);
    return `/upload/${sanitizedEntity}/${sanitizedId}`;
  } else {
    return `/upload/${sanitizedEntity}/temp`;
  }
}

/**
 * Estrae chiave da URL pubblico
 *
 * @param url - URL pubblico del file
 * @returns Chiave del file o null se URL non valido
 *
 * @example
 * extractKeyFromUrl('/api/uploads/brand-logos/2025/01/15/uuid.png')
 * // → '2025/01/15/uuid.png'
 *
 * @example
 * extractKeyFromUrl('https://api.example.com/uploads/brand-logos/2025/01/15/uuid.png')
 * // → '2025/01/15/uuid.png'
 */
export function extractKeyFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    // Pattern per URL proxy: /api/uploads/{bucket}/{key}
    const proxyMatch = url.match(/\/api\/uploads\/[^/]+\/(.+)$/);
    if (proxyMatch) {
      return decodeURIComponent(proxyMatch[1]);
    }

    // Pattern per URL diretto: {base}/uploads/{bucket}/{key}
    const directMatch = url.match(/\/uploads\/[^/]+\/(.+)$/);
    if (directMatch) {
      return decodeURIComponent(directMatch[1]);
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Estrae bucket da URL pubblico
 *
 * @param url - URL pubblico del file
 * @returns Bucket del file o null se URL non valido
 */
export function extractBucketFromUrl(url: string): StorageBucket | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    // Pattern per URL proxy: /api/uploads/{bucket}/{key}
    const proxyMatch = url.match(/\/api\/uploads\/([^/]+)\//);
    if (proxyMatch) {
      return proxyMatch[1] as StorageBucket;
    }

    // Pattern per URL diretto: {base}/uploads/{bucket}/{key}
    const directMatch = url.match(/\/uploads\/([^/]+)\//);
    if (directMatch) {
      return directMatch[1] as StorageBucket;
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Valida se un URL è un URL pubblico valido per storage
 *
 * @param url - URL da validare
 * @returns true se URL è valido per storage
 */
export function isValidStorageUrl(url: string): boolean {
  return extractKeyFromUrl(url) !== null;
}

/**
 * Sanitizza chiave file per sicurezza
 *
 * @param key - Chiave da sanitizzare
 * @returns Chiave sanitizzata
 */
function sanitizeKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid key: must be non-empty string');
  }

  // Rimuovi caratteri pericolosi e path traversal
  const sanitized = key
    .replace(/[^a-zA-Z0-9._/-]/g, '') // Solo caratteri sicuri
    .replace(/\.\./g, '') // Rimuovi ..
    .replace(/\/+/g, '/') // Normalizza separatori
    .replace(/^\/+|\/+$/g, ''); // Rimuovi slash iniziali/finali

  if (!sanitized) {
    throw new Error('Key sanitization resulted in empty string');
  }

  return sanitized;
}

/**
 * Sanitizza nome entità per endpoint
 *
 * @param entity - Nome entità da sanitizzare
 * @returns Nome sanitizzato
 */
function sanitizeEntityName(entity: string): string {
  if (!entity || typeof entity !== 'string') {
    throw new Error('Invalid entity name: must be non-empty string');
  }

  return entity
    .replace(/[^a-zA-Z0-9-]/g, '-') // Solo caratteri sicuri per URL
    .replace(/-+/g, '-') // Normalizza trattini
    .replace(/^-+|-+$/g, ''); // Rimuovi trattini iniziali/finali
}

/**
 * Sanitizza ID per endpoint
 *
 * @param id - ID da sanitizzare
 * @returns ID sanitizzato
 */
function sanitizeId(id: string): string {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid ID: must be non-empty string');
  }

  return id
    .replace(/[^a-zA-Z0-9_-]/g, '') // Solo caratteri sicuri
    .substring(0, 100); // Limita lunghezza
}

/**
 * Converte configurazione LocalStorageConfig a UrlConfig
 *
 * @param config - Configurazione storage locale
 * @param frontendBaseUrl - URL base frontend (opzionale)
 * @returns Configurazione URL
 */
export function storageConfigToUrlConfig(
  config: LocalStorageConfig,
  frontendBaseUrl?: string
): UrlConfig {
  return {
    publicBaseUrl: (config as any).publicBaseUrl,
    enableProxy: (config as any).enableProxy ?? true,
    frontendBaseUrl,
  };
}

/**
 * TODO: Presigned upload support
 *
 * Future implementation for presigned upload URLs:
 * - generatePresignedUploadUrl(bucket, key, expiresIn)
 * - validatePresignedToken(token, bucket, key)
 * - cleanupPresignedUploads()
 *
 * This will enable direct client-to-storage uploads for better
 * performance and reduced backend load.
 */
