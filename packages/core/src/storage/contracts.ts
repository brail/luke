/**
 * @luke/core/storage - Contracts for URL generation and storage management
 *
 * Shared functions for public URL generation, parsing and utilities
 * to maintain consistency between frontend and backend.
 *
 * @version 0.1.0
 * @author Luke Team
 */

import type { StorageBucket } from './types.js';

const VALID_BUCKETS: readonly StorageBucket[] = [
  'uploads',
  'exports',
  'assets',
  'brand-logos',
  'collection-row-pictures',
  'collection-row-pictures-revisions',
  'merchandising-specsheet-images',
  'company-assets',
];

function isValidBucket(value: string): value is StorageBucket {
  return (VALID_BUCKETS as readonly string[]).includes(value);
}

/**
 * Configuration for URL generation
 */
export interface UrlConfig {
  /** Backend base URL (e.g. http://localhost:3001) */
  publicBaseUrl?: string;
  /** Whether to enable Next.js proxy for file serving */
  enableProxy?: boolean;
  /** Frontend base URL for proxy (e.g. http://localhost:3000) */
  frontendBaseUrl?: string;
}

/**
 * Generates a public URL for a file in storage
 *
 * @param bucket - File bucket
 * @param key - File key
 * @param config - URL configuration
 * @returns Public URL for file access
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
  const { enableProxy = true, publicBaseUrl } = config;

  // Sanitize key for security
  const sanitizedKey = sanitizeKey(key);

  if (enableProxy) {
    // Use Next.js proxy (DEV or when configured)
    return `/api/uploads/${bucket}/${sanitizedKey}`;
  } else {
    // Use direct backend (PROD)
    if (!publicBaseUrl) {
      throw new Error('publicBaseUrl required when proxy is disabled');
    }
    return `${publicBaseUrl}/uploads/${bucket}/${sanitizedKey}`;
  }
}

/**
 * Generates proxy URL (always relative to frontend)
 *
 * @param bucket - File bucket
 * @param key - File key
 * @returns Relative proxy URL
 */
export function getProxyUrl(bucket: StorageBucket, key: string): string {
  const sanitizedKey = sanitizeKey(key);
  return `/api/uploads/${bucket}/${sanitizedKey}`;
}

/**
 * Constructs backend upload endpoint
 *
 * @param entity - Entity type (e.g. 'brand-logo')
 * @param id - Entity ID (optional for temporary uploads)
 * @returns Complete upload endpoint
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
 * Extracts key from public URL
 *
 * @param url - Public URL of the file
 * @returns File key or null if URL is invalid
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
    // Pattern for proxy URL: /api/uploads/{bucket}/{key}
    const proxyMatch = url.match(/\/api\/uploads\/[^/]+\/(.+)$/);
    if (proxyMatch) {
      return decodeURIComponent(proxyMatch[1]);
    }

    // Pattern for direct URL: {base}/uploads/{bucket}/{key}
    const directMatch = url.match(/\/uploads\/[^/]+\/(.+)$/);
    if (directMatch) {
      return decodeURIComponent(directMatch[1]);
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts bucket from public URL
 *
 * @param url - Public URL of the file
 * @returns File bucket or null if URL is invalid
 */
export function extractBucketFromUrl(url: string): StorageBucket | null {
  if (!url || typeof url !== 'string') {
    return null;
  }

  try {
    // Pattern for proxy URL: /api/uploads/{bucket}/{key}
    const proxyMatch = url.match(/\/api\/uploads\/([^/]+)\//);
    if (proxyMatch) {
      const candidate = proxyMatch[1];
      if (!isValidBucket(candidate)) return null;
      return candidate;
    }

    // Pattern for direct URL: {base}/uploads/{bucket}/{key}
    const directMatch = url.match(/\/uploads\/([^/]+)\//);
    if (directMatch) {
      const candidate = directMatch[1];
      if (!isValidBucket(candidate)) return null;
      return candidate;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Validates if a URL is a valid public storage URL
 *
 * @param url - URL to validate
 * @returns true if URL is valid for storage
 */
export function isValidStorageUrl(url: string): boolean {
  return extractKeyFromUrl(url) !== null;
}

/**
 * Sanitizes file key for security
 *
 * @param key - Key to sanitize
 * @returns Sanitized key
 */
function sanitizeKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid key: must be non-empty string');
  }

  // Remove dangerous characters and path traversal
  const sanitized = key
    .replace(/[^a-zA-Z0-9._/-]/g, '') // Only safe characters
    .replace(/\.\./g, '') // Remove ..
    .replace(/\/+/g, '/') // Normalize separators
    .replace(/^\/+|\/+$/g, ''); // Remove leading/trailing slashes

  if (!sanitized) {
    throw new Error('Key sanitization resulted in empty string');
  }

  return sanitized;
}

/**
 * Sanitizes entity name for endpoint
 *
 * @param entity - Entity name to sanitize
 * @returns Sanitized name
 */
function sanitizeEntityName(entity: string): string {
  if (!entity || typeof entity !== 'string') {
    throw new Error('Invalid entity name: must be non-empty string');
  }

  return entity
    .replace(/[^a-zA-Z0-9-]/g, '-') // Only safe characters for URL
    .replace(/-+/g, '-') // Normalize dashes
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing dashes
}

/**
 * Sanitizes ID for endpoint
 *
 * @param id - ID to sanitize
 * @returns Sanitized ID
 */
function sanitizeId(id: string): string {
  if (!id || typeof id !== 'string') {
    throw new Error('Invalid ID: must be non-empty string');
  }

  return id
    .replace(/[^a-zA-Z0-9_-]/g, '') // Only safe characters
    .substring(0, 100); // Limit length
}

/**
 * Presigned upload support
 *
 * Future implementation for presigned upload URLs:
 * - generatePresignedUploadUrl(bucket, key, expiresIn)
 * - validatePresignedToken(token, bucket, key)
 * - cleanupPresignedUploads()
 *
 * This will enable direct client-to-storage uploads for better
 * performance and reduced backend load.
 */
