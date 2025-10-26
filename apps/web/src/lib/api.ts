/**
 * Helper per URL API backend
 *
 * Centralizza la gestione degli URL del backend per evitare hardcoding
 * e facilitare la configurazione per diversi ambienti.
 */

/**
 * Ottiene l'URL base del backend API
 *
 * @returns URL base del backend (es. http://localhost:3001)
 */
export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}

/**
 * Costruisce URL completo per endpoint API
 *
 * @param endpoint - Endpoint API (es. '/upload/brand-logo/brand-123')
 * @returns URL completo (es. 'http://localhost:3001/upload/brand-logo/brand-123')
 */
export function buildApiUrl(endpoint: string): string {
  const baseUrl = getApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${baseUrl}${cleanEndpoint}`;
}

/**
 * Costruisce URL per upload brand logo
 *
 * @param brandId - ID del brand
 * @returns URL per upload logo brand
 */
export function buildBrandLogoUploadUrl(brandId: string): string {
  return buildApiUrl(`/upload/brand-logo/${brandId}`);
}

/**
 * Costruisce URL per upload temporaneo brand logo
 *
 * @returns URL per upload temporaneo
 */
export function buildTempBrandLogoUploadUrl(): string {
  return buildApiUrl('/upload/brand-logo/temp');
}
