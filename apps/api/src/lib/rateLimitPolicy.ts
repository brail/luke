/**
 * Rate-limit policy resolver.
 * Resolves a route's policy: AppConfig → built-in default.
 */

import { z } from 'zod';

import {
  RateLimitConfigSchema,
  RateLimitPolicySchema,
  type RateLimitConfig,
  type RateLimitPolicy,
  isDevelopment,
  rateLimitWindowMs,
} from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { getConfig } from './configManager';
import { rootLogger } from './logger';

const logger = rootLogger.child({ module: 'rate-limit-policy' });

/**
 * Conservative built-in defaults for backwards compatibility.
 * Development environments use relaxed limits (100× the production values).
 *
 * Keyed by every route of `RateLimitConfig`, so a route added to the config schema and
 * missing here fails `tsc`. Exported because staying in sync with `RATE_LIMIT_CONFIG`
 * (`lib/ratelimit.ts`) is a checkable invariant, tested in `ratelimit.spec.ts`.
 */
export const RATE_LIMIT_POLICY_DEFAULTS: Record<keyof RateLimitConfig, RateLimitPolicy> = {
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
    max: 1, // 1 sync per entity per window (keyed in integrations.nav.router.ts), prevents connection pool exhaustion
    timeWindow: '10m',
    keyBy: 'userId',
  },
  googleOAuthExchange: {
    max: isDevelopment() ? 100 : 10,
    timeWindow: '15m',
    keyBy: 'ip',
  },
  exportGeneration: {
    max: isDevelopment() ? 100 : 10,
    timeWindow: '1m',
    keyBy: 'userId',
  },
};

/**
 * In-memory, per-process cache of the stored per-route policies. `auth.login` resolves two
 * buckets in the same attempt (`login` via `withRateLimit`, `loginByUsername` in
 * `verifyCredentials()`) — without this cache every login attempt makes TWO identical queries on
 * the same row, and an invalid entry would be warned about on every request. Short TTL: a config
 * change via the admin UI takes at most this long to propagate, acceptable for a rate-limit number
 * (unlike a binary security value such as a permission).
 */
const RATE_LIMIT_CONFIG_CACHE_TTL_MS = 2000;
type StoredPolicies = Partial<RateLimitConfig>;
let cachedPolicies: { policies: StoredPolicies; expiresAt: number } | null = null;

/**
 * The stored `rateLimit` value, validated route by route: an invalid entry is dropped with a
 * warning naming its route, and only that route falls back to its default — a valid stricter
 * `login` survives a bad `exportGeneration`. Keys that name no route are ignored.
 */
function parseStoredPolicies(value: string | null): StoredPolicies {
  if (!value) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch (error) {
    logger.warn({ err: error }, 'AppConfig rateLimit is not valid JSON: every route uses its default');
    return {};
  }
  const entries = z.record(z.string(), z.unknown()).safeParse(raw);
  if (!entries.success) {
    logger.warn('AppConfig rateLimit is not an object: every route uses its default');
    return {};
  }

  const policies: StoredPolicies = {};
  for (const route of RateLimitConfigSchema.keyof().options) {
    const entry = entries.data[route];
    if (entry === undefined) continue;
    const policy = RateLimitPolicySchema.safeParse(entry);
    if (policy.success) policies[route] = policy.data;
    else logger.warn({ route, issues: policy.error.issues }, 'Invalid AppConfig rateLimit entry: the route uses its default');
  }
  return policies;
}

async function fetchStoredPolicies(prisma: PrismaClient): Promise<StoredPolicies> {
  const now = Date.now();
  if (cachedPolicies && cachedPolicies.expiresAt > now) {
    return cachedPolicies.policies;
  }

  const policies = parseStoredPolicies(await getConfig(prisma, 'rateLimit'));
  cachedPolicies = { policies, expiresAt: now + RATE_LIMIT_CONFIG_CACHE_TTL_MS };
  return policies;
}

/** Forces the next `resolveRateLimitPolicy` call to re-read AppConfig. Test-only. */
export function clearRateLimitConfigCache(): void {
  cachedPolicies = null;
}

/**
 * Resolves the effective rate-limit policy for a named route.
 * Resolution order: the route's AppConfig entry (`rateLimit` JSON key) → built-in default; an
 * invalid entry falls through to the default for that route only, with a warning. There is no
 * environment tier: it read `parseInt` unchecked (a non-numeric max became `NaN`, which disables
 * the limit) and sat outside the env policy.
 *
 * @param routeName - A route of `RateLimitConfig`.
 * @param prisma - Prisma client used to read AppConfig.
 * @returns Resolved policy with `max`, `windowMs`, and `keyBy`.
 */
export async function resolveRateLimitPolicy(
  routeName: keyof RateLimitConfig,
  prisma: PrismaClient
): Promise<{ max: number; windowMs: number; keyBy: RateLimitPolicy['keyBy'] }> {
  let policy: RateLimitPolicy | undefined;
  try {
    policy = (await fetchStoredPolicies(prisma))[routeName];
  } catch (error) {
    logger.warn({ err: error }, 'Failed to read AppConfig rateLimit: the route uses its default');
  }

  const { max, timeWindow, keyBy } = policy ?? RATE_LIMIT_POLICY_DEFAULTS[routeName];
  const windowMs = rateLimitWindowMs(timeWindow);
  // Unreachable: a stored entry is validated above, and the defaults are tested against the schema.
  if (windowMs === null) throw new Error(`Invalid rate-limit window for ${routeName}: ${timeWindow}`);
  return { max, windowMs, keyBy };
}
