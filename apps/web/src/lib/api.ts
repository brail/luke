import {
  getApiBaseUrl as getCoreApiBaseUrl,
  buildApiUrl as buildCoreApiUrl,
  buildBrandLogoUploadUrl as buildCoreBrandLogoUploadUrl,
  buildTempBrandLogoUploadUrl as buildCoreTempBrandLogoUploadUrl,
} from '@luke/core';

/**
 * @deprecated Use @luke/core utilities directly instead.
 * This file will be removed in a future version.
 *
 * Helper per URL API backend
 *
 * Centralizza la gestione degli URL del backend per evitare hardcoding
 * e facilitare la configurazione per diversi ambienti.
 */

/**
 * @deprecated Use getApiBaseUrl from @luke/core instead
 * Ottiene l'URL base del backend API
 *
 * @returns URL base del backend (es. http://localhost:3001)
 */
export function getApiBaseUrl(): string {
  return getCoreApiBaseUrl();
}

/**
 * @deprecated Use buildApiUrl from @luke/core instead
 * Costruisce URL completo per endpoint API
 *
 * @param endpoint - Endpoint API (es. '/upload/brand-logo/brand-123')
 * @returns URL completo (es. 'http://localhost:3001/upload/brand-logo/brand-123')
 */
export function buildApiUrl(endpoint: string): string {
  return buildCoreApiUrl(endpoint);
}

/**
 * @deprecated Use buildBrandLogoUploadUrl from @luke/core instead
 * Costruisce URL per upload brand logo
 *
 * @param brandId - ID del brand
 * @returns URL per upload logo brand
 */
export function buildBrandLogoUploadUrl(brandId: string): string {
  return buildCoreBrandLogoUploadUrl(brandId);
}

/**
 * @deprecated Use buildTempBrandLogoUploadUrl from @luke/core instead
 * Costruisce URL per upload temporaneo brand logo
 *
 * @returns URL per upload temporaneo
 */
export function buildTempBrandLogoUploadUrl(): string {
  return buildCoreTempBrandLogoUploadUrl();
}
