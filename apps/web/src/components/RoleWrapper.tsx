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
 * Conditionally renders children based on the current user's Resource:Action permissions.
 *
 * Supports three permission check modes that can be combined:
 * - `permission` — user must hold this single permission
 * - `permissions` — user must hold ALL listed permissions
 * - `anyPermission` — user must hold AT LEAST ONE listed permission
 *
 * Renders `fallback` (default `null`) when the check fails or the user is not authenticated.
 *
 * @param permission - Single permission required to render children.
 * @param permissions - All of these permissions must be held.
 * @param anyPermission - At least one of these permissions must be held.
 * @param fallback - Content to render when the permission check fails.
 * @param requireAuth - When false, unauthenticated users bypass the auth check (default: true).
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
