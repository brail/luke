/**
 * @luke/core/net - URL utilities for API communication
 *
 * Centralized URL construction and management for API calls.
 * Provides consistent URL handling across client and server contexts.
 *
 * @version 0.1.0
 * @author Luke Team
 */

import { getApiBaseUrl as getCoreApiBaseUrl, isServer } from '../runtime/env';

/**
 * Options for URL construction
 */
export interface UrlOptions {
  /** Whether to prefer server-side resolution */
  ssr?: boolean;
  /** Custom base URL override */
  baseUrl?: string;
}

/**
 * Gets the API base URL with context awareness
 *
 * @param options - Configuration options
 * @returns API base URL
 *
 * @example
 * // Client-side (browser)
 * getApiBaseUrl() // → 'http://localhost:3001'
 *
 * @example
 * // Server-side with custom base
 * getApiBaseUrl({ baseUrl: 'https://api.example.com' })
 * // → 'https://api.example.com'
 */
export function getApiBaseUrl(options: UrlOptions = {}): string {
  if (options.baseUrl) {
    return options.baseUrl;
  }

  // Use environment-based resolution
  return getCoreApiBaseUrl();
}

/**
 * Builds a complete API URL from a path
 *
 * @param path - API endpoint path (e.g., '/trpc/auth.login')
 * @param options - Configuration options
 * @returns Complete API URL
 *
 * @example
 * // Basic usage
 * buildApiUrl('/trpc/auth.login')
 * // → 'http://localhost:3001/trpc/auth.login'
 *
 * @example
 * // With custom base URL
 * buildApiUrl('/upload/brand-logo/brand-123', {
 *   baseUrl: 'https://api.example.com'
 * })
 * // → 'https://api.example.com/upload/brand-logo/brand-123'
 */
export function buildApiUrl(path: string, options: UrlOptions = {}): string {
  const baseUrl = getApiBaseUrl(options);

  // Ensure path starts with /
  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  // Remove trailing slash from baseUrl to avoid double slashes
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');

  return `${cleanBaseUrl}${cleanPath}`;
}

/**
 * Builds URL for brand logo upload
 *
 * @param brandId - Brand identifier
 * @param options - Configuration options
 * @returns Upload URL for brand logo
 *
 * @example
 * buildBrandLogoUploadUrl('brand-123')
 * // → 'http://localhost:3001/upload/brand-logo/brand-123'
 */
export function buildBrandLogoUploadUrl(
  brandId: string,
  options: UrlOptions = {}
): string {
  return buildApiUrl(`/upload/brand-logo/${brandId}`, options);
}

/**
 * Builds URL for temporary brand logo upload
 *
 * @param options - Configuration options
 * @returns Upload URL for temporary brand logo
 *
 * @example
 * buildTempBrandLogoUploadUrl()
 * // → 'http://localhost:3001/upload/brand-logo/temp'
 */
export function buildTempBrandLogoUploadUrl(options: UrlOptions = {}): string {
  return buildApiUrl('/upload/brand-logo/temp', options);
}

/**
 * Builds URL for tRPC endpoint
 *
 * @param procedure - tRPC procedure path (e.g., 'auth.login')
 * @param options - Configuration options
 * @returns Complete tRPC URL
 *
 * @example
 * buildTrpcUrl('auth.login')
 * // → 'http://localhost:3001/trpc/auth.login'
 */
export function buildTrpcUrl(
  procedure: string,
  options: UrlOptions = {}
): string {
  // Remove leading slash if present
  const cleanProcedure = procedure.startsWith('/')
    ? procedure.slice(1)
    : procedure;

  return buildApiUrl(`/trpc/${cleanProcedure}`, options);
}

/**
 * Checks if a URL is a localhost URL
 *
 * @param url - URL to check
 * @returns true if URL points to localhost
 */
export function isLocalhostUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

/**
 * Checks if a URL is an API URL (points to our backend)
 *
 * @param url - URL to check
 * @returns true if URL points to our API
 */
export function isApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const apiBaseUrl = getCoreApiBaseUrl();
    const apiParsed = new URL(apiBaseUrl);

    return parsed.origin === apiParsed.origin;
  } catch {
    return false;
  }
}

/**
 * Extracts the path from a full URL
 *
 * @param url - Full URL
 * @returns Path portion of the URL
 *
 * @example
 * extractPathFromUrl('http://localhost:3001/trpc/auth.login')
 * // → '/trpc/auth.login'
 */
export function extractPathFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return null;
  }
}
