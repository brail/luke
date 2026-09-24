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
 * Minimal Prisma client interface for reading AppConfig entries.
 * Avoids importing the full PrismaClient in `@luke/core` to prevent circular dependencies.
 */
export interface IPrismaConfigClient {
  appConfig: {
    findUnique(args: {
      where: { key: string };
    }): Promise<{ value: string; isEncrypted?: boolean } | null>;
    [key: string]: any; // other Prisma methods (upsert, etc.) not typed here — see note above on circular dep
  };
  [key: string]: any; // allows a full PrismaClient to satisfy the interface without importing its types
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
