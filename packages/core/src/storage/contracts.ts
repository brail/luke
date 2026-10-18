/**
 * @luke/core/storage - Contracts for URL generation and storage management
 *
 * Shared public URL generation, so frontend and backend build the same URLs.
 *
 * @version 0.1.0
 * @author Luke Team
 */

import type { StorageBucket } from './types.js';

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
