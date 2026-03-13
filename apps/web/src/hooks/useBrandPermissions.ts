'use client';

import { useSession } from 'next-auth/react';
import { useMemo, useCallback } from 'react';

import { hasPermission, type Role } from '@luke/core';

/**
 * Hook per controllare le permissions specifiche per le operazioni su Brand
 *
 * Fornisce flag booleani per ogni azione (canList, canCreate, canUpdate, canDelete, canHardDelete)
 * con risultati in cache per evitare ricalcoli.
 *
 * @example
 * ```typescript
 * const brandPerms = useBrandPermissions();
 *
 * if (!brandPerms.canCreate) {
 *   return <div>Non hai permesso di creare brand</div>;
 * }
 *
 * return (
 *   <form>
 *     <button disabled={!brandPerms.canUpdate}>Salva</button>
 *     <button disabled={!brandPerms.canDelete}>Elimina</button>
 *     {brandPerms.canHardDelete && (
 *       <button>Elimina permanentemente</button>
 *     )}
 *   </form>
 * );
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
   * Verifica se l'utente ha permesso di editare (create o update)
   */
  const canEdit = useCallback((): boolean => {
    return permissions.canCreate || permissions.canUpdate;
  }, [permissions.canCreate, permissions.canUpdate]);

  /**
   * Verifica se l'utente è in modalità sola lettura (viewer)
   */
  const isReadOnly = useCallback((): boolean => {
    return permissions.canList && !permissions.canCreate;
  }, [permissions.canList, permissions.canCreate]);

  /**
   * Verifica se l'utente ha diritti admin
   */
  const isAdmin = useCallback((): boolean => {
    return permissions.userRole === 'admin';
  }, [permissions.userRole]);

  /**
   * Verifica se l'utente ha diritti admin o editor
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
