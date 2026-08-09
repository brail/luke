/**
 * In-memory tokenVersion cache with TTL, shared by `trpc.ts` (per-request verification) and
 * anything that revokes sessions in bulk (e.g. maintenance-mode force-logout). Split into its
 * own module so bulk-revocation code doesn't need to import `trpc.ts` itself — `trpc.ts` will
 * import `isMaintenanceActive` from `maintenanceMode.ts`, and `maintenanceMode.ts` needs to
 * clear this cache, so the cache can't live inside `trpc.ts` without a circular import.
 */

import { getTokenVersionCacheTTL } from './configManager';

import type { PrismaClient } from '@prisma/client';

export const tokenVersionCache = new Map<
  string,
  { version: number; isActive: boolean; timestamp: number }
>();

// Cache for dynamic TTL from AppConfig
let cachedTTLValue: number | null = null;
let cachedTTLTimestamp = 0;
const TTL_REFRESH_INTERVAL = 5 * 60 * 1000; // Refresh config every 5min

async function getCacheTTL(prisma: PrismaClient): Promise<number> {
  const now = Date.now();

  if (
    cachedTTLValue === null ||
    now - cachedTTLTimestamp > TTL_REFRESH_INTERVAL
  ) {
    cachedTTLValue = await getTokenVersionCacheTTL(prisma);
    cachedTTLTimestamp = now;
  }

  return cachedTTLValue;
}

/**
 * `true` if the token is still valid: `tokenVersion` matches the user row and
 * the user is active.
 *
 * Lives here, and not inside `trpc.ts`, because it needs to be callable from
 * `authenticateRequest` — i.e. from the point where the session is *built*.
 * As long as the check lived only in the tRPC middleware, every non-tRPC Fastify
 * route (logo upload, calendar export, **backup restore**) obtained a valid
 * session from a revoked token: `createUserSession` derives it purely from the
 * JWT claims, and nothing compared `tokenVersion` against the database. Session
 * revocation and account deactivation could be bypassed for the entire JWT
 * lifetime (7 days).
 *
 * `isActive` is cached alongside the version: without it, a deactivated user
 * stayed operational until the TTL expired, because the cache branch returned
 * before re-reading the row.
 */
export async function verifyTokenVersion(
  userId: string,
  tokenVersion: number | undefined,
  prisma: PrismaClient
): Promise<boolean> {
  // Reject JWTs issued before tokenVersion was introduced
  if (tokenVersion === undefined || tokenVersion === null) {
    return false;
  }

  const cached = tokenVersionCache.get(userId);
  const now = Date.now();
  const cacheTTL = await getCacheTTL(prisma);

  if (cached && now - cached.timestamp < cacheTTL) {
    return cached.isActive && cached.version === tokenVersion;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenVersion: true, isActive: true },
  });

  if (!user) return false;

  tokenVersionCache.set(userId, {
    version: user.tokenVersion,
    isActive: user.isActive,
    timestamp: now,
  });

  return user.isActive && user.tokenVersion === tokenVersion;
}

/** Removes the cached tokenVersion for a specific user — call after revoking that user's sessions. */
export function invalidateTokenVersionCache(userId: string): void {
  tokenVersionCache.delete(userId);
}

/** Clears every cached entry — call after a bulk revocation (e.g. force-logout on maintenance-mode activation) so it takes effect immediately rather than waiting out the TTL. */
export function clearTokenVersionCache(): void {
  tokenVersionCache.clear();
}
