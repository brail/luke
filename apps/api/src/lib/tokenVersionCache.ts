/**
 * In-memory tokenVersion cache with TTL, shared by `trpc.ts` (per-request verification) and
 * anything that revokes sessions in bulk (e.g. maintenance-mode force-logout). Split into its
 * own module so bulk-revocation code doesn't need to import `trpc.ts` itself — `trpc.ts` will
 * import `isMaintenanceActive` from `maintenanceMode.ts`, and `maintenanceMode.ts` needs to
 * clear this cache, so the cache can't live inside `trpc.ts` without a circular import.
 */

export const tokenVersionCache = new Map<string, { version: number; timestamp: number }>();

/** Removes the cached tokenVersion for a specific user — call after revoking that user's sessions. */
export function invalidateTokenVersionCache(userId: string): void {
  tokenVersionCache.delete(userId);
}

/** Clears every cached entry — call after a bulk revocation (e.g. force-logout on maintenance-mode activation) so it takes effect immediately rather than waiting out the TTL. */
export function clearTokenVersionCache(): void {
  tokenVersionCache.clear();
}
