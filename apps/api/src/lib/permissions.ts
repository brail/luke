/**
 * Middleware tRPC per controllo permissions Resource:Action
 *
 * Implementa enforcement granulare con cache per-request per performance.
 * Supporta wildcard matching e backward compatibility con ruoli legacy.
 */

import { TRPCError } from '@trpc/server';
import {
  hasPermission,
  hasPermissionWithGrants,
  type Permission,
  type PermissionDeclaration,
  type PermissionContext,
} from '@luke/core';
import type { Role } from '@luke/core';
import { t } from './t';
import type { Context } from './context';
import { loadUserGrants } from '../services/permissions.service';

/**
 * Cache per-request delle permissions verificate
 * Evita verifiche duplicate durante la stessa request
 */
type PermissionsCache = Map<string, boolean>;

/**
 * Estende il Context con cache permissions
 */
declare module './context' {
  interface Context {
    _permissionsCache?: PermissionsCache;
    userGrants?: string[];
  }
}

/**
 * Factory per middleware che richiede una o più permissions
 * Supporta sia role-based che user-granted permissions
 *
 * @param permissions - Permission singola, array di permissions, o PermissionDeclaration
 * @returns Middleware tRPC che verifica le permissions
 *
 * @example
 * ```typescript
 * // Permission singola
 * requirePermission('brands:create')
 *
 * // Multiple permissions (OR logic)
 * requirePermission(['brands:create', 'brands:update'])
 *
 * // Con PermissionDeclaration
 * requirePermission({
 *   required: 'brands:delete',
 *   description: 'Delete brand',
 *   context: { checkOwnership: true }
 * })
 * ```
 */
export function requirePermission(
  permission: Permission | Permission[] | PermissionDeclaration
) {
  // Normalizza input in PermissionDeclaration
  const declaration: PermissionDeclaration =
    typeof permission === 'string' || Array.isArray(permission)
      ? {
          required: permission,
          description: '',
        }
      : permission;

  const permissionArray = Array.isArray(declaration.required)
    ? declaration.required
    : [declaration.required];

  return t.middleware(async ({ ctx, next }) => {
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

    // Carica user grants una sola volta per request
    if (!ctx.userGrants && user.id) {
      try {
        ctx.userGrants = await loadUserGrants(ctx.prisma, user.id);
      } catch (error) {
        ctx.logger?.warn(
          { userId: user.id, error },
          'Failed to load user grants'
        );
        ctx.userGrants = [];
      }
    }

    // Verifica se l'utente ha almeno una delle permissions richieste (OR logic)
    let hasAnyPermission = false;
    const deniedPermissions: Permission[] = [];

    for (const perm of permissionArray) {
      const cacheKey = `${user.role}:${user.id}:${perm}`;

      // Controlla cache prima
      if (ctx._permissionsCache.has(cacheKey)) {
        const cached = ctx._permissionsCache.get(cacheKey)!;
        if (cached) {
          hasAnyPermission = true;
          break;
        }
        deniedPermissions.push(perm);
        continue;
      }

      // Verifica permission (role-based + grants)
      const allowed = hasPermissionWithGrants(
        { role: user.role as Role, id: user.id },
        perm,
        ctx.userGrants || []
      );

      // Cache risultato
      ctx._permissionsCache.set(cacheKey, allowed);

      if (allowed) {
        hasAnyPermission = true;
        break;
      } else {
        deniedPermissions.push(perm);
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

      ctx.logger?.warn(logData, 'Permission denied');

      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Accesso negato: richieste permissions ${permissionArray.join(' o ')}`,
      });
    }

    return next();
  });
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



