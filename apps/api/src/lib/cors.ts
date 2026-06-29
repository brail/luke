/**
 * Hybrid CORS configuration utility.
 * Resolution priority: AppConfig → environment variable → built-in default.
 */

/**
 * Resolved CORS configuration including the source that produced it.
 */
export interface CorsConfig {
  source: 'appConfig' | 'env' | 'default-dev' | 'default-prod-deny';
  origins: string[];
}

/**
 * Builds the CORS allowed-origins list using a three-tier resolution cascade:
 * 1. `AppConfig.security.cors.allowedOrigins` (highest priority)
 * 2. `LUKE_CORS_ALLOWED_ORIGINS` environment variable (comma-separated)
 * 3. Built-in defaults: localhost in development/test, deny-all in production
 *
 * @param env - Current runtime environment.
 * @param appConfig - Optional pre-loaded AppConfig security section.
 * @returns Resolved CORS config with the source that was used.
 */
export function buildCorsAllowedOrigins(
  env: 'development' | 'production' | 'test',
  appConfig?: { security?: { cors?: { allowedOrigins?: string[] } } }
): CorsConfig {
  // Priorità 1: AppConfig
  if (appConfig?.security?.cors?.allowedOrigins?.length) {
    return {
      source: 'appConfig',
      origins: appConfig.security.cors.allowedOrigins,
    };
  }

  // Priorità 2: ENV
  const envCsv = process.env.LUKE_CORS_ALLOWED_ORIGINS?.trim();
  if (envCsv) {
    const origins = envCsv
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    if (origins.length) {
      return {
        source: 'env',
        origins,
      };
    }
  }

  // Priorità 3: Default
  if (env === 'development' || env === 'test') {
    return {
      source: 'default-dev',
      origins: ['http://localhost:3000', 'http://localhost:5173'],
    };
  }

  // Prod: deny by default
  return {
    source: 'default-prod-deny',
    origins: [],
  };
}


