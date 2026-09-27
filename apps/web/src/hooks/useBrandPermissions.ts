'use client';

import { useSession } from 'next-auth/react';
import { useMemo, useCallback } from 'react';

import { hasPermission, type Role } from '@luke/core';

/**
 * Returns permission flags and helper methods for Brand CRUD operations,
 * derived from the current session's role. All permission checks are memoized.
 *
 * Boolean flags (use as props — do NOT call as functions):
 * `canList`, `canCreate`, `canUpdate`, `canDelete`, `isAuthenticated`
 *
 * Method helpers (call with parentheses):
 * `canEdit()`, `isReadOnly()`
 *
 * @example
 * ```typescript
 * const perms = useBrandPermissions();
 * <button disabled={!perms.canCreate}>New brand</button>
 * <button disabled={!perms.canDelete}>Delete</button>
 * ```
 */
export function useBrandPermissions() {
  const { data: session } = useSession();

  // Computes every permission in a single useMemo
  const permissions = useMemo(() => {
    if (!session?.user?.role) {
      return {
        canList: false,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
        isAuthenticated: false,
      };
    }

    const userRole = session.user.role as Role;

    // Check each permission
    const canList = hasPermission({ role: userRole }, 'brands:read');
    const canCreate = hasPermission({ role: userRole }, 'brands:create');
    const canUpdate = hasPermission({ role: userRole }, 'brands:update');
    const canDelete = hasPermission({ role: userRole }, 'brands:delete');

    return {
      canList,
      canCreate,
      canUpdate,
      canDelete,
      isAuthenticated: true,
    };
  }, [session?.user?.role]);

  /**
   * Returns `true` if the user can create or update brands.
   */
  const canEdit = useCallback((): boolean => {
    return permissions.canCreate || permissions.canUpdate;
  }, [permissions.canCreate, permissions.canUpdate]);

  /**
   * Returns `true` if the user can list brands but cannot create them (viewer role).
   */
  const isReadOnly = useCallback((): boolean => {
    return permissions.canList && !permissions.canCreate;
  }, [permissions.canList, permissions.canCreate]);


  return {
    // Permission flags
    canList: permissions.canList,
    canCreate: permissions.canCreate,
    canUpdate: permissions.canUpdate,
    canDelete: permissions.canDelete,

    // Helper methods
    canEdit,
    isReadOnly,

    // User info
    isAuthenticated: permissions.isAuthenticated,
  };
}
