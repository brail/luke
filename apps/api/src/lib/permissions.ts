/**
 * Middleware tRPC per controllo permissions Resource:Action
 *
 * Implementa enforcement granulare con cache per-request per performance.
 * Supporta wildcard matching e backward compatibility con ruoli legacy.
 */

import { TRPCError } from '@trpc/server';
import {
  hasPermission,
  type Permission,
  type PermissionContext,
} from '@luke/core';
import type { Role } from '@luke/core';
import type { Context } from './trpc';

/**
 * Cache per-request delle permissions verificate
 * Evita verifiche duplicate durante la stessa request
 */
type PermissionsCache = Map<string, boolean>;

/**
 * Estende il Context con cache permissions
 */
declare module './trpc' {
  interface Context {
    _permissionsCache?: PermissionsCache;
  }
}

/**
 * Factory per middleware che richiede una o più permissions
 *
 * @param permissions - Permission singola o array di permissions richieste
 * @returns Middleware tRPC che verifica le permissions
 *
 * @example
 * ```typescript
 * // Permission singola
 * requirePermission('brands:create')
 *
 * // Multiple permissions (OR logic)
 * requirePermission(['brands:create', 'brands:update'])
 * ```
 */
export function requirePermission(
  permissions: Permission | Permission[]
): <TOutput>(opts: {
  ctx: Context;
  next: () => Promise<TOutput>;
}) => Promise<TOutput> {
  const permissionArray = Array.isArray(permissions)
    ? permissions
    : [permissions];

  return async ({ ctx, next }) => {
    // Verifica autenticazione
    if (!ctx.session?.user) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Devi essere autenticato per accedere a questa risorsa',
      });
    }

    const user = ctx.session.user;

    // Inizializza cache se non esiste
    if (!ctx._permissionsCache) {
      ctx._permissionsCache = new Map();
    }

    // Verifica se l'utente ha almeno una delle permissions richieste (OR logic)
    let hasAnyPermission = false;
    const deniedPermissions: Permission[] = [];

    for (const permission of permissionArray) {
      const cacheKey = `${user.role}:${permission}`;

      // Controlla cache prima
      if (ctx._permissionsCache.has(cacheKey)) {
        const cached = ctx._permissionsCache.get(cacheKey)!;
        if (cached) {
          hasAnyPermission = true;
          break;
        }
        deniedPermissions.push(permission);
        continue;
      }

      // Verifica permission
      const allowed = hasPermission({ role: user.role as Role }, permission);

      // Cache risultato
      ctx._permissionsCache.set(cacheKey, allowed);

      if (allowed) {
        hasAnyPermission = true;
        break;
      } else {
        deniedPermissions.push(permission);
      }
    }

    if (!hasAnyPermission) {
      // Log strutturato per audit (senza PII)
      const logData = {
        traceId: ctx.traceId,
        userId: user.id,
        userRole: user.role,
        requestedPermissions: permissionArray,
        deniedPermissions,
        timestamp: new Date().toISOString(),
      };

      console.warn('Permission denied:', logData);

      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Accesso negato: richieste permissions ${permissionArray.join(' o ')}`,
      });
    }

    return next();
  };
}

/**
 * Helper per verificare permissions nei resolver
 * Non lancia errori, ritorna solo boolean
 *
 * @param ctx - Context tRPC
 * @param permission - Permission da verificare
 * @param context - Context opzionale per ABAC
 * @returns true se l'utente ha la permission
 *
 * @example
 * ```typescript
 * if (can(ctx, 'brands:update')) {
 *   // Logica condizionale
 * }
 * ```
 */
export function can(
  ctx: Context,
  permission: Permission,
  context?: PermissionContext
): boolean {
  if (!ctx.session?.user) {
    return false;
  }

  const user = ctx.session.user;

  // Inizializza cache se non esiste
  if (!ctx._permissionsCache) {
    ctx._permissionsCache = new Map();
  }

  const cacheKey = `${user.role}:${permission}`;

  // Controlla cache
  if (ctx._permissionsCache.has(cacheKey)) {
    return ctx._permissionsCache.get(cacheKey)!;
  }

  // Verifica permission
  const allowed = hasPermission(
    { role: user.role as Role },
    permission,
    context
  );

  // Cache risultato
  ctx._permissionsCache.set(cacheKey, allowed);

  return allowed;
}

/**
 * Helper per verificare se l'utente è admin
 * Shortcut per permission checking
 *
 * @param ctx - Context tRPC
 * @returns true se l'utente è admin
 */
export function isAdmin(ctx: Context): boolean {
  return ctx.session?.user?.role === 'admin';
}

/**
 * Helper per verificare se l'utente è admin o editor
 * Shortcut per permission checking
 *
 * @param ctx - Context tRPC
 * @returns true se l'utente è admin o editor
 */
export function isAdminOrEditor(ctx: Context): boolean {
  const role = ctx.session?.user?.role;
  return role === 'admin' || role === 'editor';
}

/**
 * Helper per verificare se l'utente può modificare un'altro utente
 * Admin può modificare tutti, altri utenti solo se stessi
 *
 * @param ctx - Context tRPC
 * @param targetUserId - ID dell'utente da modificare
 * @returns true se può modificare
 */
export function canModifyUser(ctx: Context, targetUserId: string): boolean {
  if (!ctx.session?.user) {
    return false;
  }

  const user = ctx.session.user;

  // Admin può modificare tutti
  if (isAdmin(ctx)) {
    return true;
  }

  // Utenti possono modificare solo se stessi
  return user.id === targetUserId;
}

/**
 * Configurazione middleware esportata per test e debugging
 */
export const PERMISSIONS_MIDDLEWARE_CONFIG = {
  cacheEnabled: true,
  logDenied: true,
} as const;
