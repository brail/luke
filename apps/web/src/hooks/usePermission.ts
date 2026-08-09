'use client';

import { useSession } from 'next-auth/react';
import { useCallback } from 'react';

import { hasPermission, type Permission, type Role } from '@luke/core';

/**
 * Returns permission-check helpers derived from the current session's role,
 * following the Resource:Action pattern defined in `@luke/core`.
 *
 * @returns `{ can, canAll, canAny, getUserRole, isAuthenticated, session }`
 *
 * @example
 * ```typescript
 * const { can, canAll } = usePermission();
 * if (can('brands:create')) { ... }
 * if (canAll(['brands:create', 'brands:update'])) { ... }
 * ```
 */
export function usePermission() {
  const { data: session } = useSession();

  /**
   * Returns `true` if the current user holds the given permission.
   *
   * @param permission - Permission to check, e.g. `'brands:create'`, `'users:read'`.
   */
  const can = useCallback(
    (permission: Permission): boolean => {
      if (!session?.user?.role) {
        return false;
      }

      return hasPermission({ role: session.user.role as Role }, permission);
    },
    [session?.user?.role]
  );

  /**
   * Returns `true` if the current user holds every permission in the array.
   *
   * @param permissions - All permissions that must be granted.
   */
  const canAll = useCallback(
    (permissions: Permission[]): boolean => {
      if (!session?.user?.role) {
        return false;
      }

      const userRole = session.user.role as Role;
      return permissions.every(permission =>
        hasPermission({ role: userRole }, permission)
      );
    },
    [session?.user?.role]
  );

  /**
   * Returns `true` if the current user holds at least one permission in the array.
   *
   * @param permissions - At least one of these must be granted.
   */
  const canAny = useCallback(
    (permissions: Permission[]): boolean => {
      if (!session?.user?.role) {
        return false;
      }

      const userRole = session.user.role as Role;
      return permissions.some(permission =>
        hasPermission({ role: userRole }, permission)
      );
    },
    [session?.user?.role]
  );

  /**
   * Returns the current user's role (`admin`, `editor`, or `viewer`),
   * or `undefined` when not authenticated.
   */
  const getUserRole = useCallback((): Role | undefined => {
    return (session?.user?.role as Role) || undefined;
  }, [session?.user?.role]);

  /**
   * Returns `true` if the user is currently authenticated (session user is present).
   */
  const isAuthenticated = useCallback((): boolean => {
    return !!session?.user;
  }, [session?.user]);

  return {
    // Core permission checking
    can,
    canAll,
    canAny,

    // User info
    getUserRole,
    isAuthenticated,

    // Session data
    session,
  };
}
