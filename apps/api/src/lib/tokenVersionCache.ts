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

// Cache per TTL dinamico da AppConfig
let cachedTTLValue: number | null = null;
let cachedTTLTimestamp = 0;
const TTL_REFRESH_INTERVAL = 5 * 60 * 1000; // Refresh config ogni 5min

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
 * `true` se il token è ancora valido: `tokenVersion` allineato alla riga utente e
 * utente attivo.
 *
 * Vive qui, e non dentro `trpc.ts`, perché deve poter essere chiamata da
 * `authenticateRequest` — cioè dal punto in cui la sessione viene *costruita*.
 * Finché la verifica stava solo nel middleware tRPC, ogni route Fastify non-tRPC
 * (upload logo, export calendario, **restore di backup**) otteneva una sessione
 * valida da un token revocato: `createUserSession` la deriva dai soli claim del
 * JWT, e nessuno confrontava `tokenVersion` con il database. Revoca sessioni e
 * disattivazione account erano aggirabili per tutta la vita del JWT (7 giorni).
 *
 * `isActive` è in cache accanto alla versione: senza, un utente disattivato
 * restava operativo fino alla scadenza del TTL, perché il ramo cache usciva
 * prima di rileggere la riga.
 */
export async function verifyTokenVersion(
  userId: string,
  tokenVersion: number | undefined,
  prisma: PrismaClient
): Promise<boolean> {
  // Rifiuta i JWT emessi prima dell'introduzione di tokenVersion
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
