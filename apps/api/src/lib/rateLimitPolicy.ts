/**
 * Rate-limit policy resolver.
 * Implements a three-tier resolution cascade: AppConfig → environment variable → built-in default.
 */

import pino from 'pino';

import { RateLimitConfigSchema, type RateLimitPolicy, isDevelopment } from '@luke/core';

import { getConfig } from './configManager';

import type { PrismaClient } from '@prisma/client';

const logger = pino({ level: 'info' });

/**
 * Conservative built-in defaults for backwards compatibility.
 * Development environments use relaxed limits (100× the production values).
 *
 * Exported because staying in sync with `RATE_LIMIT_CONFIG` (`lib/ratelimit.ts`) is
 * a checkable invariant: `resolveRateLimitPolicy` throws at runtime on a route
 * missing from here, so a key added to only one of the two maps
 * becomes a production crash instead of a compile-time error.
 */
export const RATE_LIMIT_POLICY_DEFAULTS: Record<string, RateLimitPolicy> = {
  login: { max: 5, timeWindow: '1m', keyBy: 'ip' },
  loginByUsername: { max: 10, timeWindow: '15m', keyBy: 'username' },
  passwordChange: { max: 3, timeWindow: '15m', keyBy: 'userId' },
  passwordReset: { max: 3, timeWindow: '15m', keyBy: 'ip' },
  configMutations: {
    max: isDevelopment() ? 100 : 20,
    timeWindow: '1m',
    keyBy: 'userId',
  },
  userMutations: {
    max: isDevelopment() ? 100 : 10,
    timeWindow: '1m',
    keyBy: 'userId',
  },
  brandMutations: {
    max: isDevelopment() ? 100 : 10,
    timeWindow: '1m',
    keyBy: 'userId',
  },
  sectionAccessSet: {
    max: isDevelopment() ? 100 : 20,
    timeWindow: '1m',
    keyBy: 'userId',
  },
  pendingEmail: {
    max: isDevelopment() ? 100 : 10,
    timeWindow: '15m',
    keyBy: 'ip',
  },
  ldapTest: {
    max: isDevelopment() ? 100 : 3,
    timeWindow: '15m',
    keyBy: 'userId',
  },
  companyStructureMutations: {
    max: isDevelopment() ? 100 : 30,
    timeWindow: '1m',
    keyBy: 'userId',
  },
  navSyncTrigger: {
    max: 1, // 1 sync per window, prevents connection pool exhaustion
    timeWindow: '10m',
    keyBy: 'userId',
  },
  exportGeneration: {
    max: isDevelopment() ? 100 : 10,
    timeWindow: '1m',
    keyBy: 'userId',
  },
};

/**
 * In-memory, per-process cache of the raw AppConfig `rateLimit` value. `auth.login`
 * resolves two buckets in the same attempt (`login` via `withRateLimit`, `loginByUsername`
 * in `authenticateUser()`) — without this cache every login attempt makes TWO
 * identical queries on the same row. Short TTL: a config change via the admin UI takes at
 * most this long to propagate, acceptable for a rate-limit number (unlike a binary
 * security value such as a permission).
 */
const RATE_LIMIT_CONFIG_CACHE_TTL_MS = 2000;
let cachedConfigValue: { value: string | null; expiresAt: number } | null = null;

async function fetchRateLimitConfigValue(
  prisma: PrismaClient
): Promise<string | null> {
  const now = Date.now();
  if (cachedConfigValue && cachedConfigValue.expiresAt > now) {
    return cachedConfigValue.value;
  }

  const value = await getConfig(prisma, 'rateLimit', false);
  cachedConfigValue = { value, expiresAt: now + RATE_LIMIT_CONFIG_CACHE_TTL_MS };
  return value;
}

/** Forces the next `resolveRateLimitPolicy` call to re-read AppConfig. Test-only. */
export function clearRateLimitConfigCache(): void {
  cachedConfigValue = null;
}

function parseTimeWindow(window: string): number {
  const match = window.match(/^(\d+)(s|m|h)$/);
  if (!match) {
    throw new Error(
      `Invalid timeWindow format: ${window}. Expected format: 30s, 1m, 2h`
    );
  }

  const [, value, unit] = match;
  const num = parseInt(value, 10);

  if (isNaN(num) || num <= 0) {
    throw new Error(
      `Invalid timeWindow value: ${value}. Must be a positive number`
    );
  }

  switch (unit) {
    case 's':
      return num * 1000;
    case 'm':
      return num * 60 * 1000;
    case 'h':
      return num * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown time unit: ${unit}. Supported: s, m, h`);
  }
}

/**
 * Resolves the effective rate-limit policy for a named route.
 * Resolution order: AppConfig (`rateLimit` JSON key) → environment variables
 * (`LUKE_RATE_LIMIT_<ROUTE>_MAX/WINDOW/KEY_BY`) → built-in defaults.
 * Invalid or malformed config at any tier falls through to the next tier.
 *
 * @param routeName - Route identifier; must be present in the RATE_LIMIT_POLICY_DEFAULTS map.
 * @param prisma - Prisma client used to read AppConfig.
 * @returns Resolved policy with `max`, `windowMs`, and `keyBy`.
 */
export async function resolveRateLimitPolicy(
  routeName: keyof typeof RATE_LIMIT_POLICY_DEFAULTS,
  prisma: PrismaClient
): Promise<{ max: number; windowMs: number; keyBy: 'ip' | 'userId' | 'username' }> {
  // 1) AppConfig attempt (single 'rateLimit' key with JSON object)
  try {
    const configValue = await fetchRateLimitConfigValue(prisma);
    if (configValue) {
      const parsed = JSON.parse(configValue);
      const validated = RateLimitConfigSchema.safeParse(parsed);

      if (
        validated.success &&
        validated.data[routeName as keyof typeof validated.data]
      ) {
        const policy =
          validated.data[routeName as keyof typeof validated.data]!;
        return {
          max: policy.max,
          windowMs: parseTimeWindow(policy.timeWindow),
          keyBy: policy.keyBy,
        };
      }
    }
  } catch (error) {
    // Log the error but continue with fallback
    logger.warn({ err: error }, 'Failed to parse AppConfig rateLimit');
  }

  // 2) ENV fallback (e.g. LUKE_RATE_LIMIT_LOGIN_MAX, LUKE_RATE_LIMIT_LOGIN_WINDOW, LUKE_RATE_LIMIT_LOGIN_KEY_BY)
  const envKey = routeName.toUpperCase();
  const maxEnv = process.env[`LUKE_RATE_LIMIT_${envKey}_MAX`];
  const windowEnv = process.env[`LUKE_RATE_LIMIT_${envKey}_WINDOW`];
  const keyByEnv = process.env[`LUKE_RATE_LIMIT_${envKey}_KEY_BY`];

  if (maxEnv || windowEnv || keyByEnv) {
    const def = RATE_LIMIT_POLICY_DEFAULTS[routeName];
    try {
      return {
        max: maxEnv ? parseInt(maxEnv, 10) : def.max,
        windowMs: windowEnv
          ? parseTimeWindow(windowEnv)
          : parseTimeWindow(def.timeWindow),
        keyBy: (keyByEnv as 'ip' | 'userId' | 'username') || def.keyBy,
      };
    } catch (error) {
      logger.warn({ err: error, routeName }, 'Invalid ENV rate limit config');
      // Fall back to defaults if ENV is malformed
    }
  }

  // 3) Safe defaults
  const def = RATE_LIMIT_POLICY_DEFAULTS[routeName];
  return {
    max: def.max,
    windowMs: parseTimeWindow(def.timeWindow),
    keyBy: def.keyBy,
  };
}
