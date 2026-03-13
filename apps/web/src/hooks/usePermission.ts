'use client';

import { useSession } from 'next-auth/react';
import { useCallback } from 'react';

import { hasPermission, type Permission, type Role } from '@luke/core';

/**
 * Hook generico per verificare qualsiasi permission
 *
 * Fornisce un metodo semplice per controllare i permessi usando il pattern Resource:Action
 *
 * @example
 * ```typescript
 * const { can } = usePermission();
 *
 * if (can('brands:create')) {
 *   return <CreateBrandButton />;
 * }
 *
 * if (can('users:delete')) {
 *   return <DeleteUserButton />;
 * }
 * ```
 */
export function usePermission() {
  const { data: session } = useSession();

  /**
   * Verifica se l'utente ha una permission specifica
   *
   * @param permission - Permission da verificare (es. 'brands:create', 'users:read')
   * @returns true se l'utente ha la permission
   *
   * @example
   * ```typescript
   * const { can } = usePermission();
   * can('brands:create') // true per admin/editor, false per viewer
   * can('users:read') // true per tutti
   * can('config:update') // true per admin/editor
   * ```
   */
  const can = useCallback(
    (permission: Permission): boolean => {
      if (!session?.user?.role) {
        return false;
      }

      return hasPermission(
        { role: session.user.role as Role },
        permission
      );
    },
    [session?.user?.role]
  );

  /**
   * Verifica se l'utente ha tutte le permissions richieste
   *
   * @param permissions - Array di permissions richieste
   * @returns true se l'utente ha tutte le permissions
   *
   * @example
   * ```typescript
   * const { canAll } = usePermission();
   * canAll(['brands:create', 'brands:update']) // true se ha entrambe
   * ```
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
   * Verifica se l'utente ha almeno una delle permissions richieste
   *
   * @param permissions - Array di permissions richieste
   * @returns true se l'utente ha almeno una permission
   *
   * @example
   * ```typescript
   * const { canAny } = usePermission();
   * canAny(['brands:create', 'brands:update']) // true se ha almeno una
   * ```
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
   * Ottiene il ruolo dell'utente corrente
   *
   * @returns Il ruolo dell'utente (admin, editor, viewer) o undefined se non autenticato
   */
  const getUserRole = useCallback((): Role | undefined => {
    return (session?.user?.role as Role) || undefined;
  }, [session?.user?.role]);

  /**
   * Verifica se l'utente è autenticato
   *
   * @returns true se l'utente è autenticato
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
