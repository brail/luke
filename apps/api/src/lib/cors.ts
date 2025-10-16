/**
 * Utility per configurazione CORS ibrida
 * Priorità: AppConfig → ENV → default
 */

export interface CorsConfig {
  source: 'appConfig' | 'env' | 'default-dev' | 'default-prod-deny';
  origins: string[];
}

/**
 * Costruisce la configurazione CORS con priorità:
 * 1. AppConfig.security.cors.allowedOrigins (se presente)
 * 2. LUKE_CORS_ALLOWED_ORIGINS (CSV)
 * 3. Default dev → localhost, prod → deny
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
