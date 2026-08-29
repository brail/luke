/**
 * @luke/core - Core package of the Luke system
 *
 * This package provides:
 * - Zod schemas for data validation (User, AppConfig)
 * - RBAC system for role and permissions management
 * - Utility functions for dates and money management
 * - Pricing functions and margin calculation
 *
 * @version 0.1.0
 * @author Luke Team
 */

// Re-export schemas
export * from './schemas/config';
export * from './schemas/user';
export * from './schemas/userProfile';
export * from './schemas/appConfig';
export * from './schemas/ldap';
export * from './schemas/mail';
export * from './schemas/nav';
export * from './schemas/auth';
export * from './schemas/brand';
export * from './schemas/season';
export * from './schemas/pricing';
export * from './schemas/collectionLayout';
export * from './schemas/phase';
export * from './schemas/merchandisingPlan';
export * from './schemas/seasonCalendar';
export * from './schemas/company';
export * from './schemas/companyProfile';
export * from './schemas/vendor';
export * from './schemas/dashboard';
export * from './schemas/notification';
export * from './schemas/backup';
export * from './schemas/auditLog';
export * from './schemas/maintenanceMode';
export * from './schemas/feedback';
export * from './schemas/confirmation';
export * from './schemas/reason';

// Re-export RBAC
export * from './rbac';

// Re-export RBAC schemas
export * from './schemas/rbac';

// Re-export effective access with explicit exports to avoid conflicts
export { effectiveSectionAccess } from './rbac/effectiveAccess';

// Re-export auth/permissions
export * from './auth/permissions';

// Re-export utilities
export * from './utils/backoff';
export * from './utils/calendarEventLock';
export * from './utils/date';
export * from './utils/dateUtils';
export * from './utils/pricing';
export * from './utils/sanitize';
export * from './utils/text';
export * from './utils/user';
export * from './utils/zod';
export * from './utils/auditLogLabels';

// Re-export storage types and config
export * from './storage/types';
export * from './storage/config';
export * from './storage/contracts';
export * from './storage/assets';

// Re-export runtime environment utilities
export {
  getApiBaseUrl as getEnvApiBaseUrl,
  getFrontendBaseUrl as getEnvFrontendBaseUrl,
  isDevelopment,
  isProduction,
  isServer,
  getEnvConfig,
  validateEnvConfig,
  getConfigValue,
  getApiBaseUrlFromConfig,
  getFrontendBaseUrlFromConfig,
} from './runtime/env';

// Re-export network URL utilities
export {
  getApiBaseUrl,
  buildApiUrl,
  buildBrandLogoUploadUrl,
  buildCompanyLogoUploadUrl,
  buildCompanyLogoUrl,
  buildTempBrandLogoUploadUrl,
  buildCollectionRowPictureUploadUrl,
  buildTempCollectionRowPictureUploadUrl,
  buildSpecsheetImageUploadUrl,
  buildTempSpecsheetImageUploadUrl,
  buildBackupExportDownloadUrl,
  buildBackupImportUrl,
  buildAuditLogExportUrl,
  buildTrpcUrl,
  buildSeasonCalendarExportUrl,
  isLocalhostUrl,
  isApiUrl,
  extractPathFromUrl,
  type UrlOptions,
} from './net/url';

// Note: server utilities are exported via @luke/core/server

// Note: crypto utilities are server-only and exported via @luke/core/server
