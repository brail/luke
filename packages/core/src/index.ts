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
export * from './schemas/config.js';
export * from './schemas/user.js';
export * from './schemas/userProfile.js';
export * from './schemas/appConfig.js';
export * from './schemas/ldap.js';
export * from './schemas/mail.js';
export * from './schemas/nav.js';
export * from './schemas/auth.js';
export * from './schemas/brand.js';
export * from './schemas/season.js';
export * from './schemas/pricing.js';
export * from './schemas/collectionLayout.js';
export * from './schemas/phase.js';
export * from './schemas/merchandisingPlan.js';
export * from './schemas/seasonCalendar.js';
export * from './schemas/company.js';
export * from './schemas/companyProfile.js';
export * from './schemas/vendor.js';
export * from './schemas/dashboard.js';
export * from './schemas/notification.js';
export * from './schemas/backup.js';
export * from './schemas/auditLog.js';
export * from './schemas/maintenanceMode.js';
export * from './schemas/feedback.js';
export * from './schemas/confirmation.js';
export * from './schemas/reason.js';
export * from './schemas/password.js';
export * from './schemas/google.js';

// Re-export RBAC
export * from './rbac.js';

// Re-export RBAC schemas
export * from './schemas/rbac.js';

// Re-export effective access with explicit exports to avoid conflicts
export { effectiveSectionAccess } from './rbac/effectiveAccess.js';

// Re-export auth/permissions
export * from './auth/permissions.js';

// Re-export utilities
export * from './utils/backoff.js';
export * from './utils/calendarEventLock.js';
export * from './utils/date.js';
export * from './utils/dateUtils.js';
export * from './utils/pricing.js';
export * from './utils/sanitize.js';
export * from './utils/text.js';
export * from './utils/user.js';
export * from './utils/zod.js';
export * from './utils/auditLogLabels.js';

// Re-export storage types and config
export * from './storage/types.js';
export * from './storage/config.js';
export * from './storage/contracts.js';
export * from './storage/assets.js';

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
} from './runtime/env.js';

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
} from './net/url.js';

// Note: server utilities are exported via @luke/core/server

// Note: crypto utilities are server-only and exported via @luke/core/server
