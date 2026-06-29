'use client';

import { useSession } from 'next-auth/react';
import { useMemo, useCallback } from 'react';

import { hasPermission, type Role } from '@luke/core';

/**
 * Returns permission flags and helper methods for Brand CRUD operations,
 * derived from the current session's role. All permission checks are memoized.
 *
 * Boolean flags (use as props — do NOT call as functions):
 * `canList`, `canCreate`, `canUpdate`, `canDelete`, `canHardDelete`, `isAuthenticated`
 *
 * Method helpers (call with parentheses):
 * `canEdit()`, `isReadOnly()`, `isAdmin()`, `isAdminOrEditor()`
 *
 * @example
 * ```typescript
 * const perms = useBrandPermissions();
 * <button disabled={!perms.canCreate}>New brand</button>
 * <button disabled={!perms.canDelete}>Delete</button>
 * {perms.canHardDelete && <button>Hard delete</button>}
 * ```
 */
export function useBrandPermissions() {
  const { data: session } = useSession();

  // Calcola i permessi in un unico useMemo per ottimizzazione
  const permissions = useMemo(() => {
    if (!session?.user?.role) {
      return {
        canList: false,
        canCreate: false,
        canUpdate: false,
        canDelete: false,
        canHardDelete: false,
        isAuthenticated: false,
        userRole: undefined as Role | undefined,
      };
    }

    const userRole = session.user.role as Role;

    // Verifica ogni permission
    const canList = hasPermission({ role: userRole }, 'brands:read');
    const canCreate = hasPermission({ role: userRole }, 'brands:create');
    const canUpdate = hasPermission({ role: userRole }, 'brands:update');
    const canDelete = hasPermission({ role: userRole }, 'brands:delete');

    // Hard delete è solo per admin
    const canHardDelete = userRole === 'admin';

    return {
      canList,
      canCreate,
      canUpdate,
      canDelete,
      canHardDelete,
      isAuthenticated: true,
      userRole,
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

  /**
   * Returns `true` if the user has the `admin` role.
   */
  const isAdmin = useCallback((): boolean => {
    return permissions.userRole === 'admin';
  }, [permissions.userRole]);

  /**
   * Returns `true` if the user has the `admin` or `editor` role.
   */
  const isAdminOrEditor = useCallback((): boolean => {
    return (
      permissions.userRole === 'admin' || permissions.userRole === 'editor'
    );
  }, [permissions.userRole]);

  return {
    // Permission flags
    canList: permissions.canList,
    canCreate: permissions.canCreate,
    canUpdate: permissions.canUpdate,
    canDelete: permissions.canDelete,
    canHardDelete: permissions.canHardDelete,

    // Helper methods
    canEdit,
    isReadOnly,
    isAdmin,
    isAdminOrEditor,

    // User info
    isAuthenticated: permissions.isAuthenticated,
    userRole: permissions.userRole,
  };
}
