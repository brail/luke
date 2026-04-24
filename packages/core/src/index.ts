/**
 * @luke/core - Pacchetto core del sistema Luke
 *
 * Questo pacchetto fornisce:
 * - Schemi Zod per validazione dati (User, AppConfig)
 * - Sistema RBAC per gestione ruoli e permissions
 * - Utility per date e gestione denaro
 * - Funzioni di pricing e calcolo margini
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
export * from './schemas/merchandisingPlan';
export * from './schemas/vendor';
export * from './schemas/dashboard';

// Re-export RBAC
export * from './rbac';

// Re-export RBAC schemas
export * from './schemas/rbac';

// Re-export effective access with explicit exports to avoid conflicts
export { effectiveSectionAccess } from './rbac/effectiveAccess';

// Re-export auth/permissions
export * from './auth/permissions';

// Re-export utilities
export * from './utils/date';
export * from './utils/sanitize';

// Re-export storage types and config
export * from './storage/types';
export * from './storage/config';
export * from './storage/contracts';

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
  buildTempBrandLogoUploadUrl,
  buildCollectionRowPictureUploadUrl,
  buildTempCollectionRowPictureUploadUrl,
  buildSpecsheetImageUploadUrl,
  buildTempSpecsheetImageUploadUrl,
  buildTrpcUrl,
  isLocalhostUrl,
  isApiUrl,
  extractPathFromUrl,
  type UrlOptions,
} from './net/url';

// Note: server utilities are exported via @luke/core/server

// Note: crypto utilities are server-only and exported via @luke/core/server
