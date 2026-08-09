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
    // CSP: production only for JSON-only API
    contentSecurityPolicy: isDevelopment
      ? false // Disables CSP in dev to avoid issues
      : {
          directives: {
            defaultSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'none'"],
          },
        },

    // HSTS: production only
    hsts: isProduction
      ? {
          maxAge: 15552000, // 180 days
          includeSubDomains: true,
          preload: false, // Do not force preload
        }
      : false,

    // Headers always present for security
    noSniff: true, // X-Content-Type-Options: nosniff
    referrerPolicy: { policy: 'no-referrer' }, // Referrer-Policy: no-referrer
    frameguard: { action: 'deny' }, // X-Frame-Options: DENY
    dnsPrefetchControl: { allow: false }, // X-DNS-Prefetch-Control: off
  };
}
