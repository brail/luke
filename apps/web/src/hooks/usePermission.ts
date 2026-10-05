'use client';

import { useSession } from 'next-auth/react';
import { useCallback } from 'react';

import { hasPermission, type Permission, type Role } from '@luke/core';

/**
 * Returns permission-check helpers derived from the current session's role,
 * following the Resource:Action pattern defined in `@luke/core`.
 *
 * @returns `{ can, isAuthenticated, session }`
 *
 * @example
 * ```typescript
 * const { can } = usePermission();
 * if (can('brands:create')) { ... }
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
   * Returns `true` if the user is currently authenticated (session user is present).
   */
  const isAuthenticated = useCallback((): boolean => {
    return !!session?.user;
  }, [session?.user]);

  return {
    // Core permission checking
    can,

    // User info
    isAuthenticated,

    // Session data
    session,
  };
}
