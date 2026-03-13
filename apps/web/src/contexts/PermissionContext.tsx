'use client';

import { useSession } from 'next-auth/react';
import React, { createContext, useContext, useCallback, useMemo } from 'react';

import {
  hasPermission,
  expandRole,
  type Permission,
  type Role,
} from '@luke/core';

/**
 * Tipo per il context delle permissions
 */
interface PermissionContextType {
  // Verificare permissions
  hasPermission: (permission: Permission) => boolean;
  hasAllPermissions: (permissions: Permission[]) => boolean;
  hasAnyPermission: (permissions: Permission[]) => boolean;

  // Ottiene le permissions dell'utente
  getUserPermissions: () => Permission[];

  // Info utente
  getUserRole: () => Role | undefined;
  isAuthenticated: () => boolean;
  isAdmin: () => boolean;
  isAdminOrEditor: () => boolean;

  // Dati grezzi
  userRole: Role | undefined;
  userPermissions: Permission[];
  isLoading: boolean;
}

/**
 * Context per gestire le permissions dell'applicazione
 */
const PermissionContext = createContext<PermissionContextType | undefined>(
  undefined
);

/**
 * Props per PermissionContextProvider
 */
interface PermissionContextProviderProps {
  children: React.ReactNode;
}

/**
 * Provider per il context delle permissions
 * Fornisce accesso alle permissions dell'utente corrente e helper per il checking
 *
 * @example
 * ```tsx
 * export function RootLayout({ children }) {
 *   return (
 *     <SessionProvider>
 *       <PermissionContextProvider>
 *         {children}
 *       </PermissionContextProvider>
 *     </SessionProvider>
 *   );
 * }
 * ```
 */
export function PermissionContextProvider({
  children,
}: PermissionContextProviderProps) {
  const { data: session, status } = useSession();

  // Calcola le permissions dell'utente
  const userRole = useMemo(
    () => (session?.user?.role as Role | undefined),
    [session?.user?.role]
  );

  const userPermissions = useMemo((): Permission[] => {
    if (!userRole) {
      return [];
    }
    return expandRole(userRole);
  }, [userRole]);

  // Funzione per verificare una permission specifica
  const checkPermission = useCallback(
    (permission: Permission): boolean => {
      if (!userRole) {
        return false;
      }
      return hasPermission({ role: userRole }, permission);
    },
    [userRole]
  );

  // Verifica se l'utente ha tutte le permissions
  const checkAllPermissions = useCallback(
    (permissions: Permission[]): boolean => {
      if (!userRole) {
        return false;
      }
      return permissions.every(permission => checkPermission(permission));
    },
    [userRole, checkPermission]
  );

  // Verifica se l'utente ha almeno una permission
  const checkAnyPermission = useCallback(
    (permissions: Permission[]): boolean => {
      if (!userRole) {
        return false;
      }
      return permissions.some(permission => checkPermission(permission));
    },
    [userRole, checkPermission]
  );

  // Ottiene il ruolo dell'utente
  const getRoleCallback = useCallback(() => userRole, [userRole]);

  // Verifica se è autenticato
  const checkAuthenticated = useCallback(() => !!session?.user, [session?.user]);

  // Verifica se è admin
  const checkIsAdmin = useCallback(() => userRole === 'admin', [userRole]);

  // Verifica se è admin o editor
  const checkIsAdminOrEditor = useCallback(
    () => userRole === 'admin' || userRole === 'editor',
    [userRole]
  );

  const contextValue: PermissionContextType = {
    hasPermission: checkPermission,
    hasAllPermissions: checkAllPermissions,
    hasAnyPermission: checkAnyPermission,
    getUserPermissions: () => userPermissions,
    getUserRole: getRoleCallback,
    isAuthenticated: checkAuthenticated,
    isAdmin: checkIsAdmin,
    isAdminOrEditor: checkIsAdminOrEditor,
    userRole,
    userPermissions,
    isLoading: status === 'loading',
  };

  return (
    <PermissionContext.Provider value={contextValue}>
      {children}
    </PermissionContext.Provider>
  );
}

/**
 * Hook per accedere al context delle permissions
 *
 * @returns Il context delle permissions
 * @throws Error se utilizzato fuori da PermissionContextProvider
 *
 * @example
 * ```typescript
 * const { hasPermission, isAdmin } = usePermissionContext();
 *
 * if (hasPermission('brands:create')) {
 *   // Mostra il pulsante di creazione
 * }
 * ```
 */
export function usePermissionContext(): PermissionContextType {
  const context = useContext(PermissionContext);

  if (context === undefined) {
    throw new Error(
      'usePermissionContext must be used within a PermissionContextProvider'
    );
  }

  return context;
}
