/**
 * CORS allowed-origins resolution: environment variable → built-in default.
 *
 * Not AppConfig: the Fastify instance registers CORS once at construction, before the application
 * reads its configuration, and the allowed origins describe the network boundary, like
 * `LUKE_TRUSTED_PROXY_CIDR`. An AppConfig tier used to be declared here that no caller ever fed.
 */

/**
 * Resolved CORS configuration including the source that produced it.
 */
export interface CorsConfig {
  source: 'env' | 'default-dev' | 'default-prod-deny';
  origins: string[];
}

/**
 * Builds the CORS allowed-origins list:
 * 1. `LUKE_CORS_ALLOWED_ORIGINS` environment variable (comma-separated)
 * 2. Built-in defaults: localhost in development/test, deny-all in production
 *
 * @param env - Current runtime environment.
 * @returns Resolved CORS config with the source that was used.
 */
export function buildCorsAllowedOrigins(
  env: 'development' | 'production' | 'test'
): CorsConfig {
  // Priority 1: ENV
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

  // Priority 2: Default
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


