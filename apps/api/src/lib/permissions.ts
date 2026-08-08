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
 * Resolves the required permission(s) from the procedure's parsed input — for the rare case where
 * the permission depends on a runtime field (e.g. which entity type is being locked). The `.use()`
 * call must come *after* `.input()` in the procedure chain, otherwise `input` is not yet parsed.
 */
type PermissionResolver<TInput> = (input: TInput) => Permission | Permission[] | PermissionDeclaration;

function normalizeDeclaration(
  resolved: Permission | Permission[] | PermissionDeclaration
): PermissionDeclaration {
  return typeof resolved === 'string' || Array.isArray(resolved)
    ? { required: resolved, description: '' }
    : resolved;
}

/**
 * Factory for middleware that requires one or more permissions
 * Supports both role-based and user-granted permissions
 *
 * @param permission - A single permission, an array of permissions, a PermissionDeclaration, or a
 *   `(input) => Permission` function for cases where the permission depends on the parsed input
 *   (in that case `.use(requirePermission(...))` must be placed after `.input(...)` in the chain, and
 *   the generic type `TInput` must be passed explicitly — e.g. `requirePermission<MyInput>(...)`).
 * @returns tRPC middleware that checks the permissions
 *
 * @example
 * ```typescript
 * // Single permission
 * requirePermission('brands:create')
 *
 * // Multiple permissions (OR logic)
 * requirePermission(['brands:create', 'brands:update'])
 *
 * // With PermissionDeclaration
 * requirePermission({
 *   required: 'brands:delete',
 *   description: 'Delete brand',
 *   context: { checkOwnership: true }
 * })
 *
 * // Input-dependent (requires .use() after .input())
 * requirePermission<{ entityType: 'X' | 'Y' }>((input) => input.entityType === 'X' ? 'x:update' : 'y:update')
 * ```
 */
export function requirePermission<TInput = never>(
  permission: Permission | Permission[] | PermissionDeclaration | PermissionResolver<TInput>
) {
  // Static case: normalize once at middleware-construction time (router build), not per request —
  // only the resolver form needs the parsed `input` and must wait for the request.
  const staticDeclaration = typeof permission === 'function' ? null : normalizeDeclaration(permission);

  return t.middleware(async ({ ctx, next, input }) => {
    const declaration = staticDeclaration ?? normalizeDeclaration((permission as PermissionResolver<TInput>)(input as TInput));

    const permissionArray = Array.isArray(declaration.required)
      ? declaration.required
      : [declaration.required];

    // Check authentication
    if (!ctx.session?.user) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Devi essere autenticato per accedere a questa risorsa',
      });
    }

    const user = ctx.session.user;

    // Initialize cache if it doesn't exist
    if (!ctx._permissionsCache) {
      ctx._permissionsCache = new Map();
    }

    // Check whether the user has at least one of the required permissions (OR logic)
    let hasAnyPermission = false;
    const deniedPermissions: Permission[] = [];

    for (const perm of permissionArray) {
      const cacheKey = `${user.role}:${user.id}:${perm}`;

      // Check cache first
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

      // Cache the result
      ctx._permissionsCache.set(cacheKey, allowed);

      if (allowed) {
        hasAnyPermission = true;
        break;
      } else {
        deniedPermissions.push(perm);
      }
    }

    if (!hasAnyPermission) {
      // Structured log for audit (no PII)
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

  // Initialize cache if it doesn't exist
  if (!ctx._permissionsCache) {
    ctx._permissionsCache = new Map();
  }

  const cacheKey = `${user.role}:${user.id}:${permission}`;

  // Check cache
  if (ctx._permissionsCache.has(cacheKey)) {
    return ctx._permissionsCache.get(cacheKey)!;
  }

  // Check permission
  const allowed = hasPermission(
    { role: user.role as Role },
    permission
  );

  // Cache the result
  ctx._permissionsCache.set(cacheKey, allowed);

  return allowed;
}



