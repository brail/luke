/**
 * tRPC middleware for Resource:Action permission enforcement.
 * Implements granular access control with a per-request cache for performance.
 * Supports wildcard matching and backward compatibility with legacy roles.
 */

import { TRPCError } from '@trpc/server';

import {
  hasPermission,
  type Permission,
  type PermissionDeclaration,
  type Role,
} from '@luke/core';

import { t } from './t';

import type { Context } from './context';

/**
 * Per-request permission check cache — prevents duplicate lookups within a single request.
 */
type PermissionsCache = Map<string, boolean>;

/**
 * Augments the tRPC Context with the per-request permissions cache.
 */
declare module './context' {
  interface Context {
    _permissionsCache?: PermissionsCache;
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

      const allowed = hasPermission({ role: user.role as Role }, perm);

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
 * Checks a single permission for the current user without throwing.
 * Results are cached per-request via `ctx._permissionsCache`.
 *
 * @param ctx - tRPC context.
 * @param permission - Permission string to check (e.g. `'brands:update'`).
 * @returns `true` if the user holds the permission, `false` otherwise (including unauthenticated).
 *
 * @example
 * ```typescript
 * if (can(ctx, 'brands:update')) {
 *   // conditional logic
 * }
 * ```
 */
export function can(
  ctx: Context,
  permission: Permission
): boolean {
  if (!ctx.session?.user) {
    return false;
  }

  const user = ctx.session.user;

  // Inizializza cache se non esiste
  if (!ctx._permissionsCache) {
    ctx._permissionsCache = new Map();
  }

  const cacheKey = `${user.role}:${user.id}:${permission}`;

  // Controlla cache
  if (ctx._permissionsCache.has(cacheKey)) {
    return ctx._permissionsCache.get(cacheKey)!;
  }

  // Verifica permission
  const allowed = hasPermission(
    { role: user.role as Role },
    permission
  );

  // Cache risultato
  ctx._permissionsCache.set(cacheKey, allowed);

  return allowed;
}



