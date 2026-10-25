/**
 * @luke/core/net - URL utilities for API communication
 *
 * Centralized URL construction and management for API calls.
 * Provides consistent URL handling across client and server contexts.
 *
 * @version 0.1.0
 * @author Luke Team
 */

import { getApiBaseUrl } from '../runtime/env.js';
import { getProxyUrl } from '../storage/contracts.js';

import type { AuditLogExportFormat } from '../schemas/auditLog.js';

/**
 * Builds a complete API URL from a path
 *
 * @param path - API endpoint path (e.g., '/trpc/auth.login')
 * @returns Complete API URL
 *
 * @example
 * // Basic usage
 * buildApiUrl('/trpc/auth.login')
 * // → '/trpc/auth.login'
 */
export function buildApiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();

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
 * @returns Upload URL for brand logo
 *
 * @example
 * buildBrandLogoUploadUrl('brand-123')
 * // → '/upload/brand-logo/brand-123'
 */
export function buildBrandLogoUploadUrl(brandId: string): string {
  return buildApiUrl(`/upload/brand-logo/${brandId}`);
}

/**
 * Builds URL for temporary brand logo upload
 *
 * @returns Upload URL for temporary brand logo
 *
 * @example
 * buildTempBrandLogoUploadUrl()
 * // → '/upload/brand-logo/temp'
 */
export function buildTempBrandLogoUploadUrl(): string {
  return buildApiUrl('/upload/brand-logo/temp');
}

/**
 * Builds the upload URL for a collection row picture.
 *
 * @param rowId - UUID of the collection row
 */
export function buildCollectionRowPictureUploadUrl(rowId: string): string {
  return buildApiUrl(`/upload/collection-row-picture/${rowId}`);
}

/**
 * Builds the upload URL for a temporary (pre-commit) collection row picture.
 * The file is later committed to a permanent key when the row is saved.
 */
export function buildTempCollectionRowPictureUploadUrl(): string {
  return buildApiUrl('/upload/collection-row-picture/temp');
}

/**
 * Builds the upload URL for the company logo. No ID is needed because the company profile is a singleton.
 */
export function buildCompanyLogoUploadUrl(): string {
  return buildApiUrl('/upload/company-logo');
}

/**
 * Builds the proxy URL for serving the company logo through the Next.js `/api/uploads` route.
 *
 * @param logoKey - Storage key of the logo file
 */
export function buildCompanyLogoUrl(logoKey: string): string {
  return getProxyUrl('company-assets', logoKey);
}

/**
 * Builds the upload URL for a merchandising specsheet image.
 *
 * @param specsheetId - UUID of the specsheet
 */
export function buildSpecsheetImageUploadUrl(specsheetId: string): string {
  return buildApiUrl(`/upload/specsheet-image/${specsheetId}`);
}

// Raw (non-tRPC) endpoints the *browser* calls directly must live under `/download/` (streamed
// GET) or `/upload/` (streamed POST). In production the browser can only reach Next.js (apps/api
// publishes no port — see docker-compose.prod.yml), so such a path is reachable only if
// `apps/web/next.config.js` rewrites it; those two prefixes are the ones wired there wholesale.
// A path outside them resolves to a Next.js page route instead: no error, just Next's own 404
// HTML delivered under the requested filename — exactly how backup downloads shipped 24KB of 404
// page in place of the backup. Enforced by `apps/api/test/rawRouteProxy.spec.ts`.
/**
 * Builds the download URL for a passphrase-protected, instance-portable backup export package.
 *
 * @param id - Backup UUID
 * @param token - Signed export token minted by `maintenance.backup.prepareExport`
 */
export function buildBackupExportDownloadUrl(
  id: string,
  token: string
): string {
  return buildApiUrl(`/download/backup/${id}/export?token=${encodeURIComponent(token)}`);
}

/**
 * Builds the upload URL for importing a passphrase-protected backup export package.
 */
export function buildBackupImportUrl(): string {
  return buildApiUrl('/upload/backup-import');
}

/**
 * Builds the export download URL for the audit log.
 *
 * @param format - `csv` or `xlsx`
 * @param token - Signed export token minted by `auditLog.getExportLink`, encoding the applied filters
 */
export function buildAuditLogExportUrl(format: AuditLogExportFormat, token: string): string {
  return buildApiUrl(`/download/audit-log?format=${format}&token=${encodeURIComponent(token)}`);
}

/**
 * Builds URL for tRPC endpoint
 *
 * @param procedure - tRPC procedure path (e.g., 'auth.login')
 * @returns Complete tRPC URL
 *
 * @example
 * buildTrpcUrl('auth.login')
 * // → '/trpc/auth.login'
 */
export function buildTrpcUrl(procedure: string): string {
  // Remove leading slash if present
  const cleanProcedure = procedure.startsWith('/')
    ? procedure.slice(1)
    : procedure;

  return buildApiUrl(`/trpc/${cleanProcedure}`);
}

/**
 * The most calls one tRPC batch request may carry. Each call in a batch runs its own procedure, so
 * an unbounded batch lets one request start any number of them. The API refuses a larger batch
 * (`maxBatchSize`) and every client link splits at it (`maxItems`): a busy page sends a second
 * request instead of being refused.
 */
export const TRPC_MAX_BATCH_SIZE = 20;

/**
 * Builds the export download URL for a season calendar.
 *
 * Authenticated with a Bearer token by the caller (`fetch`), not a signed query token — these
 * generate their payload from the database on the fly rather than serving a stored file.
 *
 * @param format - `ical` (.ics), `pdf`, or `xlsx`
 * @param params - Season and brand scope; `view`/`viewDate` select the PDF layout and are
 *                 ignored by the other two formats
 */
export function buildSeasonCalendarExportUrl(
  format: 'ical' | 'pdf' | 'xlsx',
  params: {
    seasonId: string;
    brandIds: string[];
    view?: 'list' | 'week' | 'month' | 'gantt' | 'day';
    /** The `YYYY-MM-DD` calendar date the viewer is looking at — a date, never an instant. */
    viewDate?: string;
  }
): string {
  const query = new URLSearchParams({
    seasonId: params.seasonId,
    brandIds: params.brandIds.join(','),
  });
  if (format === 'pdf') {
    if (params.view) query.set('view', params.view);
    if (params.viewDate) query.set('viewDate', params.viewDate);
  }
  return buildApiUrl(`/download/season-calendar/${format}?${query.toString()}`);
}
