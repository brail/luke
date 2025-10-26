'use client';

import { useSession } from 'next-auth/react';
import { useMemo, useCallback } from 'react';

import {
  hasPermission,
  expandRole,
  type Permission,
  type Role,
} from '@luke/core';

/**
 * Hook per controllo accesso basato su permissions Resource:Action
 *
 * Fornisce helper per verificare permissions e accesso granulare
 * con cache ottimizzata e integrazione con session management
 *
 * @example
 * ```typescript
 * const { can, permissions } = useAccess();
 *
 * // Verifica permission specifica
 * if (can('brands:create')) {
 *   // Mostra pulsante crea brand
 * }
 *
 * // Verifica multiple permissions
 * const canManageBrands = can('brands:create') && can('brands:update');
 * ```
 */
export function useAccess() {
  const { data: session } = useSession();

  // Cache delle permissions dell'utente corrente
  const permissions = useMemo(() => {
    if (!session?.user?.role) {
      return new Set<Permission>();
    }

    const userRole = session.user.role as Role;
    return new Set(expandRole(userRole));
  }, [session?.user?.role]);

  /**
   * Verifica se l'utente ha una permission specifica
   *
   * @param permission - Permission da verificare (es. 'brands:create')
   * @returns true se l'utente ha la permission
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
   * Verifica se l'utente ha tutte le permissions richieste
   *
   * @param requiredPermissions - Array di permissions richieste
   * @returns true se l'utente ha tutte le permissions
   */
  const canAll = useCallback(
    (requiredPermissions: Permission[]): boolean => {
      if (!session?.user?.role) {
        return false;
      }

      return requiredPermissions.every(permission =>
        hasPermission({ role: session.user.role as Role }, permission)
      );
    },
    [session?.user?.role]
  );

  /**
   * Verifica se l'utente ha almeno una delle permissions richieste
   *
   * @param requiredPermissions - Array di permissions richieste
   * @returns true se l'utente ha almeno una permission
   */
  const canAny = useCallback(
    (requiredPermissions: Permission[]): boolean => {
      if (!session?.user?.role) {
        return false;
      }

      return requiredPermissions.some(permission =>
        hasPermission({ role: session.user.role as Role }, permission)
      );
    },
    [session?.user?.role]
  );

  /**
   * Verifica se l'utente è admin
   * Shortcut per permission checking
   *
   * @returns true se l'utente è admin
   */
  const isAdmin = useCallback((): boolean => {
    return session?.user?.role === 'admin';
  }, [session?.user?.role]);

  /**
   * Verifica se l'utente è admin o editor
   * Shortcut per permission checking
   *
   * @returns true se l'utente è admin o editor
   */
  const isAdminOrEditor = useCallback((): boolean => {
    const role = session?.user?.role;
    return role === 'admin' || role === 'editor';
  }, [session?.user?.role]);

  /**
   * Verifica se l'utente è viewer
   * Shortcut per permission checking
   *
   * @returns true se l'utente è viewer
   */
  const isViewer = useCallback((): boolean => {
    return session?.user?.role === 'viewer';
  }, [session?.user?.role]);

  return {
    // Permission checking
    can,
    canAll,
    canAny,

    // Role checking shortcuts
    isAdmin,
    isAdminOrEditor,
    isViewer,

    // Data
    permissions,
    userRole: session?.user?.role as Role | undefined,
    isAuthenticated: !!session?.user,
  };
}
