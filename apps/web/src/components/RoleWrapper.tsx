'use client';

import React from 'react';

import type { Permission } from '@luke/core';

import { usePermission } from '../hooks/usePermission';

/**
 * Props per il componente RoleWrapper
 */
interface RoleWrapperProps {
  children: React.ReactNode;
  /**
   * Permission da verificare (es. 'brands:create', 'users:read')
   * Se specificato, il componente viene renderizzato solo se l'utente ha questa permission
   */
  permission?: Permission;
  /**
   * Array di permissions - il componente viene renderizzato se l'utente ha TUTTE
   */
  permissions?: Permission[];
  /**
   * Array di permissions - il componente viene renderizzato se l'utente ha ALMENO UNA
   */
  anyPermission?: Permission[];
  /**
   * Fallback da renderizzare se le permissions non sono soddisfatte
   */
  fallback?: React.ReactNode;
  /**
   * Se true, renderizza il componente anche se non autenticato
   * (default: false)
   */
  requireAuth?: boolean;
}

/**
 * Componente per renderizzare contenuti basato su permissions
 *
 * Permette di controllare la visibilità dei componenti basandosi su
 * permission specifiche dell'utente (Resource:Action pattern)
 *
 * @example
 * ```tsx
 * // Renderizza solo se l'utente ha permission 'brands:create'
 * <RoleWrapper permission="brands:create">
 *   <CreateBrandButton />
 * </RoleWrapper>
 *
 * // Renderizza solo se ha TUTTE le permissions
 * <RoleWrapper permissions={['brands:create', 'brands:update']}>
 *   <BrandForm />
 * </RoleWrapper>
 *
 * // Renderizza solo se ha ALMENO UNA delle permissions
 * <RoleWrapper anyPermission={['brands:create', 'brands:update']}>
 *   <EditableContent />
 * </RoleWrapper>
 *
 * // Con fallback se non autorizzato
 * <RoleWrapper
 *   permission="brands:delete"
 *   fallback={<p>Non hai i permessi per eliminare</p>}
 * >
 *   <DeleteButton />
 * </RoleWrapper>
 * ```
 */
export function RoleWrapper({
  children,
  permission,
  permissions,
  anyPermission,
  fallback = null,
  requireAuth = true,
}: RoleWrapperProps) {
  const { can, canAll, canAny, isAuthenticated } = usePermission();

  // Verifica autenticazione
  if (requireAuth && !isAuthenticated()) {
    return fallback;
  }

  // Verifica permission singola
  if (permission !== undefined && !can(permission)) {
    return fallback;
  }

  // Verifica tutte le permissions
  if (permissions !== undefined && !canAll(permissions)) {
    return fallback;
  }

  // Verifica almeno una permission
  if (anyPermission !== undefined && !canAny(anyPermission)) {
    return fallback;
  }

  // Se tutte le verifiche passano, renderizza il contenuto
  return <>{children}</>;
}
