/**
 * @luke/core/runtime - Configuration management
 *
 * Centralized configuration management using AppConfig system.
 * Provides typed configuration access for both client and server contexts.
 *
 * @version 0.2.0
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

// Minimal interface to avoid full PrismaClient dependency issues in core
export interface IPrismaConfigClient {
  appConfig: {
    findUnique(args: {
      where: { key: string };
    }): Promise<{ value: string; isEncrypted?: boolean } | null>;
    [key: string]: any;
  };
  [key: string]: any;
}

/**
 * Gets the API base URL synchronously (client-side compatible)
 *
 * Priority:
 * 1. NEXT_PUBLIC_API_URL environment variable
 * 2. Development fallback (localhost:3001)
 * 3. Build-time fallback (localhost:3001)
 *
 * @returns API base URL
 */
export function getApiBaseUrl(): string {
  // Server-side (SSR, middleware, Next.js API routes): use internal Docker URL directly
  // to avoid looping through the public hostname
  if (typeof window === 'undefined') {
    const internalUrl = process.env.INTERNAL_API_URL;
    if (internalUrl) return internalUrl;
  }

  // Client-side (browser): use the public-facing URL
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envUrl) return envUrl;

  // Dev / build fallback
  return 'http://localhost:3001';
}

/**
 * Gets the frontend base URL synchronously (client-side compatible)
 *
 * Priority:
 * 1. NEXT_PUBLIC_FRONTEND_URL environment variable
 * 2. Development fallback (localhost:3000)
 * 3. Build-time fallback (localhost:3000)
 *
 * @returns Frontend base URL
 */
export function getFrontendBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_FRONTEND_URL;

  if (envUrl) {
    return envUrl;
  }

  // Always use localhost fallback for development and build
  // This prevents build errors during prerendering
  return 'http://localhost:3000';
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

/**
 * Gets configuration value from AppConfig (server-side only)
 *
 * This function is intended for server-side use where Prisma is available.
 * For client-side configuration, use environment variables or tRPC calls.
 *
 * @param prisma - Prisma client instance
 * @param key - Configuration key (e.g., 'app.urls.apiBase')
 * @param defaultValue - Default value if not found
 * @returns Configuration value or default
 */
export async function getConfigValue(
  prisma: IPrismaConfigClient,
  key: string,
  defaultValue?: string
): Promise<string | undefined> {
  try {
    const config = await prisma.appConfig.findUnique({
      where: { key },
    });

    return config?.value ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Gets API base URL from AppConfig (server-side only)
 * Falls back to environment variable or localhost
 *
 * @param prisma - Prisma client instance
 * @returns API base URL
 */
export async function getApiBaseUrlFromConfig(
  prisma: IPrismaConfigClient
): Promise<string> {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envUrl) {
    return envUrl;
  }

  try {
    const config = await getConfigValue(prisma, 'app.apiBaseUrl');
    if (config) {
      return config;
    }
  } catch {
    // silently fall through to localhost default
  }

  // Fallback to localhost
  return 'http://localhost:3001';
}

/**
 * Gets frontend base URL from AppConfig (server-side only)
 * Falls back to environment variable or localhost
 *
 * @param prisma - Prisma client instance
 * @returns Frontend base URL
 */
export async function getFrontendBaseUrlFromConfig(
  prisma: IPrismaConfigClient
): Promise<string> {
  const envUrl = process.env.NEXT_PUBLIC_FRONTEND_URL;
  if (envUrl) {
    return envUrl;
  }

  try {
    const config = await getConfigValue(prisma, 'app.baseUrl');
    if (config) {
      return config;
    }
  } catch {
    // silently fall through to localhost default
  }

  // Fallback to localhost
  return 'http://localhost:3000';
}
