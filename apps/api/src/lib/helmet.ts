/**
 * Centralised Helmet security-header configuration.
 * Provides an immutable baseline for all API versions.
 */

/**
 * Typed Helmet plugin configuration subset used by the API.
 */
export interface HelmetConfig {
  contentSecurityPolicy?:
    | false
    | {
        directives: {
          defaultSrc: string[];
          frameAncestors: string[];
          baseUri: string[];
        };
      };
  hsts?:
    | false
    | {
        maxAge: number;
        includeSubDomains: boolean;
        preload: boolean;
      };
  noSniff: boolean;
  referrerPolicy: { policy: 'no-referrer' };
  frameguard: { action: 'deny' };
  dnsPrefetchControl: { allow: false };
}

/**
 * Builds a Helmet configuration object tuned for the given environment.
 * CSP is disabled in development; HSTS is enabled only in production.
 *
 * @param env - Runtime environment (`'development'`, `'test'`, or `'production'`).
 * @returns Helmet configuration optimised for the environment.
 */
export function buildHelmetConfig(env: string): HelmetConfig {
  const isDevelopment = env === 'development';
  const isProduction = env === 'production';

  return {
    // CSP: solo in produzione per API JSON-only
    contentSecurityPolicy: isDevelopment
      ? false // Disabilita CSP in dev per evitare problemi
      : {
          directives: {
            defaultSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'none'"],
          },
        },

    // HSTS: solo in produzione
    hsts: isProduction
      ? {
          maxAge: 15552000, // 180 giorni
          includeSubDomains: true,
          preload: false, // Non forzare preload
        }
      : false,

    // Header sempre presenti per sicurezza
    noSniff: true, // X-Content-Type-Options: nosniff
    referrerPolicy: { policy: 'no-referrer' }, // Referrer-Policy: no-referrer
    frameguard: { action: 'deny' }, // X-Frame-Options: DENY
    dnsPrefetchControl: { allow: false }, // X-DNS-Prefetch-Control: off
  };
}

/**
 * Reference map of security headers applied per environment.
 * Intended for documentation and test assertions; actual headers are set by Helmet.
 */
export const SECURITY_HEADERS = {
  development: {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-DNS-Prefetch-Control': 'off',
    'X-Frame-Options': 'DENY',
    // CSP e HSTS disabilitati in dev
  },
  test: {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-DNS-Prefetch-Control': 'off',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    // HSTS disabilitato in test
  },
  production: {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-DNS-Prefetch-Control': 'off',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    'Strict-Transport-Security': 'max-age=15552000; includeSubDomains',
  },
} as const;
