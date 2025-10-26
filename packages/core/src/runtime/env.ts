/**
 * @luke/core/runtime - Environment variables management
 *
 * Typed environment variables with runtime validation and safe defaults.
 * Centralizes environment configuration for both client and server contexts.
 *
 * @version 0.1.0
 * @author Luke Team
 */

/**
 * Environment configuration interface
 */
export interface EnvConfig {
  /** API base URL for backend communication */
  apiBaseUrl: string;
  /** Whether we're running in development mode */
  isDevelopment: boolean;
  /** Whether we're running in production mode */
  isProduction: boolean;
  /** Whether we're running on the server side */
  isServer: boolean;
}

/**
 * Gets the API base URL from environment variables
 *
 * @param fallback - Fallback URL if NEXT_PUBLIC_API_URL is not set
 * @returns API base URL
 *
 * @example
 * // Development
 * getApiBaseUrl() // → 'http://localhost:3001'
 *
 * @example
 * // Production with env var
 * process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com'
 * getApiBaseUrl() // → 'https://api.example.com'
 */
export function getApiBaseUrl(
  fallback: string = 'http://localhost:3001'
): string {
  // In browser, process.env.NEXT_PUBLIC_API_URL is available
  // In server, we can also access it directly
  const envUrl = process.env.NEXT_PUBLIC_API_URL;

  if (envUrl) {
    return envUrl;
  }

  return fallback;
}

/**
 * Gets the frontend base URL from environment variables
 *
 * @param fallback - Fallback URL if NEXT_PUBLIC_FRONTEND_URL is not set
 * @returns Frontend base URL
 */
export function getFrontendBaseUrl(
  fallback: string = 'http://localhost:3000'
): string {
  const envUrl = process.env.NEXT_PUBLIC_FRONTEND_URL;

  if (envUrl) {
    return envUrl;
  }

  return fallback;
}

/**
 * Checks if we're running in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * Checks if we're running in production mode
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Checks if we're running on the server side
 *
 * @returns true if running on server, false if in browser
 */
export function isServer(): boolean {
  return typeof window === 'undefined';
}

/**
 * Gets complete environment configuration
 *
 * @returns Environment configuration object
 */
export function getEnvConfig(): EnvConfig {
  return {
    apiBaseUrl: getApiBaseUrl(),
    isDevelopment: isDevelopment(),
    isProduction: isProduction(),
    isServer: isServer(),
  };
}

/**
 * Validates critical environment variables at runtime
 *
 * @throws Error if critical variables are missing or invalid
 */
export function validateEnvConfig(): void {
  const config = getEnvConfig();

  // Validate API base URL format
  try {
    new URL(config.apiBaseUrl);
  } catch {
    throw new Error(`Invalid API base URL: ${config.apiBaseUrl}`);
  }

  // Additional validations can be added here
  // For example, checking for required API keys in production
  if (config.isProduction) {
    // Add production-specific validations here
  }
}
