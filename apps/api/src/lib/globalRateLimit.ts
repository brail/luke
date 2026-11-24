/**
 * The API's global request limit (ADR-051): every request counts once, per signed-in user in three
 * lanes (essential, background, normal) or, without a valid session, per client address. The numbers
 * are the `rateLimit.global` AppConfig value; per-procedure limits (`lib/ratelimit.ts`) apply on top.
 */

import { setTimeout as sleep } from 'node:timers/promises';

import { normalizeIP, type RateLimitPluginOptions } from '@fastify/rate-limit';

import {
  APP_CONFIG_DEFAULTS,
  isDevelopment,
  parseConfigValue,
  trpcLaneOf,
  type GlobalRateLimit,
  type TrpcLane,
} from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { createUserSession, extractTokenFromRequest, requestSession } from './auth';
import { getConfigOrDefault } from './configManager';
import { getTraceId } from './error';
import { rootLogger } from './logger';
import { buildRateLimitExceededError } from './rateLimitError';

import type { FastifyRequest } from 'fastify';

const logger = rootLogger.child({ module: 'global-rate-limit' });

/** How long a read of `rateLimit.global` is reused: a changed limit applies within this time. */
const LIMITS_CACHE_TTL_MS = 2000;
/** How long the limiter waits for a bearer's revocation check before keying by its signed identity. */
const SESSION_CHECK_TIMEOUT_MS = 1000;
/** At most one session-check warning in this time, not one a request during a database outage. */
const SESSION_WARNING_INTERVAL_MS = 60_000;
/** Development multiplies every limit, as the hardcoded limit did (2000 against 100). */
const DEVELOPMENT_FACTOR = 20;
/** Development never limits the machine itself. */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const LANE_LIMIT: Record<TrpcLane, Exclude<keyof GlobalRateLimit, 'perIp'>> = {
  essential: 'essentialPerUser',
  background: 'backgroundPerUser',
  normal: 'perUser',
};

const isLane = (value: string): value is TrpcLane => Object.hasOwn(LANE_LIMIT, value);

/**
 * The declared default (`APP_CONFIG_DEFAULTS`), used until the first read of `rateLimit.global`
 * completes and when no read ever has: the limiter must answer at once, and `getConfigOrDefault`,
 * which falls back only on an invalid row, cannot answer before the database does.
 */
const DEFAULT_LIMITS = parseConfigValue('rateLimit.global', APP_CONFIG_DEFAULTS['rateLimit.global']);

/** Resolves with `undefined` after `ms`, so a slow promise can be raced; the timer never holds the process. */
const after = (ms: number): Promise<undefined> => sleep(ms, undefined, { ref: false });

/** Where the limiter writes its warnings; the module logger unless a test passes its own. */
type RateLimitLogger = Pick<typeof logger, 'warn'>;

/** The path without its query string: a GET's query carries the tRPC input, never logged or matched. */
function pathOf(request: FastifyRequest): string {
  return request.url.split('?', 1)[0] ?? '';
}

/**
 * What a bucket key names. The global keys are `<lane>:u:<user id>` and `ip:<address>`; a route with
 * its own `config.rateLimit` (the season-calendar exports) inherits `onExceeded` with its own key,
 * `u:<user id>` or `ip:<address>` (`rateLimitKeyFromRequest`), which carries no lane.
 */
function describeKey(key: string): { lane?: TrpcLane; userId: string } | { ip: string } {
  const [first = '', ...rest] = key.split(':');
  if (first === 'ip') return { ip: rest.join(':') };
  if (first === 'u') return { userId: rest.join(':') };
  if (isLane(first) && rest[0] === 'u') return { lane: first, userId: rest.slice(1).join(':') };
  return { ip: key };
}

/** Options of the global `@fastify/rate-limit` registration (`server.ts`). */
export function globalRateLimitOptions(prisma: PrismaClient, log: RateLimitLogger = logger): RateLimitPluginOptions {
  let cachedLimits: { limits: GlobalRateLimit; expiresAt: number } | null = null;
  let refreshing: Promise<GlobalRateLimit> | null = null;
  let sessionWarnedAt = 0;

  /**
   * One read of `rateLimit.global`: the stored limits, the default when the row is invalid
   * (`getConfigOrDefault` warns), the last limits read (or the declared default) when it cannot be
   * read — `getConfigOrDefault` falls back only on an invalid row, and requests must keep flowing.
   */
  const refreshLimits = async (): Promise<GlobalRateLimit> => {
    let limits: GlobalRateLimit;
    try {
      limits = await getConfigOrDefault(prisma, 'rateLimit.global');
    } catch (error) {
      log.warn({ err: error }, 'Failed to read AppConfig rateLimit.global: the last or default limits apply');
      limits = cachedLimits?.limits ?? DEFAULT_LIMITS;
    }
    cachedLimits = { limits, expiresAt: Date.now() + LIMITS_CACHE_TTL_MS };
    return limits;
  };

  /**
   * The limits, served from memory while one shared read refreshes them in the background (the
   * declared default before the first read completes): a slow or hung database never makes a request
   * — a health probe included — wait on the limiter, and a burst of requests starts one read.
   */
  const readLimits = (): GlobalRateLimit => {
    if (!cachedLimits || cachedLimits.expiresAt <= Date.now()) {
      refreshing ??= refreshLimits().finally(() => {
        refreshing = null;
      });
    }
    return cachedLimits?.limits ?? DEFAULT_LIMITS;
  };

  return {
    timeWindow: '1 minute',
    cache: 10000,
    skipOnError: true,
    allowList: isDevelopment() ? (request: FastifyRequest) => LOOPBACK.has(request.ip) : undefined,

    keyGenerator: async (request: FastifyRequest) => {
      const address = `ip:${normalizeIP(request.ip)}`;
      // `allowList` runs after the key: skip the session check for a request it will exempt.
      if (isDevelopment() && LOOPBACK.has(request.ip)) return address;
      const token = extractTokenFromRequest(request);
      if (!token) return address;
      const userKey = (userId: string) => `${trpcLaneOf(pathOf(request))}:u:${userId}`;
      let problem: unknown;
      try {
        const session = await Promise.race([requestSession(request, prisma), after(SESSION_CHECK_TIMEOUT_MS)]);
        if (session !== undefined) return session ? userKey(session.user.id) : address;
        problem = new Error(`no answer within ${SESSION_CHECK_TIMEOUT_MS} ms`);
      } catch (error) {
        problem = error;
      }
      // The revocation check failed or is slow (database): a signature-checked bearer still names its
      // user, so the user keeps their own buckets instead of sharing the address's; the handler
      // refuses a revoked token anyway.
      if (Date.now() - sessionWarnedAt >= SESSION_WARNING_INTERVAL_MS) {
        sessionWarnedAt = Date.now();
        log.warn({ err: problem }, 'Session check failed for the global rate limit: keyed by the signed identity');
      }
      const signed = createUserSession(token);
      return signed ? userKey(signed.user.id) : address;
    },

    max: (_request: FastifyRequest, key: string) => {
      const limits = readLimits();
      const named = describeKey(key);
      const max = 'userId' in named ? limits[LANE_LIMIT[named.lane ?? 'normal']] : limits.perIp;
      return isDevelopment() ? max * DEVELOPMENT_FACTOR : max;
    },

    onExceeded: (request: FastifyRequest, key: string) => {
      const path = pathOf(request);
      const procedures = path.startsWith('/trpc/') ? path.slice('/trpc/'.length).split(',') : undefined;
      log.warn(
        {
          ...describeKey(key),
          traceId: getTraceId(request),
          method: request.method,
          path: procedures ? '/trpc' : path,
          procedures,
        },
        'Rate limit exceeded'
      );
    },

    // `ttl` is the time left in the window, so `retryAfterSeconds` matches the `Retry-After` header.
    errorResponseBuilder: (_request, context) => buildRateLimitExceededError(context.ttl),
  };
}
