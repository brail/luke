'use client';

import React, { type ReactNode } from 'react';

import type { Permission } from '@luke/core';

import { useAccess } from '../hooks/useAccess';

/**
 * Props per AccessGate component
 */
interface AccessGateProps {
  /** Permission richiesta per mostrare il contenuto */
  permission: Permission;
  /** Permissions alternative (OR logic) */
  permissions?: Permission[];
  /** Contenuto da mostrare se l'utente ha la permission */
  children: ReactNode;
  /** Contenuto da mostrare se l'utente NON ha la permission */
  fallback?: ReactNode;
  /** Se true, mostra il contenuto solo se l'utente NON ha la permission */
  invert?: boolean;
  /** Se true, mostra il contenuto solo se l'utente ha TUTTE le permissions */
  requireAll?: boolean;
}

/**
 * Componente per conditional rendering basato su permissions
 *
 * Nasconde/mostra contenuto in base alle permissions dell'utente corrente.
 * Supporta logica OR/AND per multiple permissions e rendering invertito.
 *
 * @example
 * ```tsx
 * // Permission singola
 * <AccessGate permission="brands:create">
 *   <CreateBrandButton />
 * </AccessGate>
 *
 * // Multiple permissions (OR logic)
 * <AccessGate permissions={['brands:create', 'brands:update']}>
 *   <BrandActions />
 * </AccessGate>
 *
 * // Rendering invertito
 * <AccessGate permission="brands:delete" invert fallback={<ReadOnlyMessage />}>
 *   <DeleteButton />
 * </AccessGate>
 *
 * // Require all permissions (AND logic)
 * <AccessGate permissions={['brands:read', 'brands:update']} requireAll>
 *   <AdvancedBrandEditor />
 * </AccessGate>
 * ```
 */
export function AccessGate({
  permission,
  permissions,
  children,
  fallback = null,
  invert = false,
  requireAll = false,
}: AccessGateProps): ReactNode {
  const { can, canAll, canAny } = useAccess();

  // Determina se l'utente ha accesso
  let hasAccess: boolean;

  if (permissions && permissions.length > 0) {
    // Multiple permissions
    if (requireAll) {
      hasAccess = canAll(permissions);
    } else {
      hasAccess = canAny(permissions);
    }
  } else {
    // Single permission
    hasAccess = can(permission);
  }

  // Applica logica invertita se richiesta
  if (invert) {
    hasAccess = !hasAccess;
  }

  // Ritorna contenuto appropriato
  return hasAccess ? <>{children}</> : <>{fallback}</>;
}

/**
 * Componente specializzato per nascondere contenuto se l'utente NON ha la permission
 * Alias per AccessGate con invert=true
 *
 * @example
 * ```tsx
 * <AccessDenied permission="brands:delete">
 *   <DeleteButton />
 * </AccessDenied>
 * ```
 */
export function AccessDenied({
  permission,
  permissions,
  children,
  fallback = null,
  requireAll = false,
}: Omit<AccessGateProps, 'invert'>): ReactNode {
  return (
    <AccessGate
      permission={permission}
      permissions={permissions}
      invert={true}
      fallback={fallback}
      requireAll={requireAll}
    >
      {children}
    </AccessGate>
  );
}

/**
 * Componente specializzato per mostrare contenuto solo se l'utente ha TUTTE le permissions
 * Alias per AccessGate con requireAll=true
 *
 * @example
 * ```tsx
 * <AccessAll permissions={['brands:read', 'brands:update', 'brands:delete']}>
 *   <FullBrandEditor />
 * </AccessAll>
 * ```
 */
export function AccessAll({
  permission,
  permissions,
  children,
  fallback = null,
}: Omit<AccessGateProps, 'requireAll' | 'invert'>): ReactNode {
  return (
    <AccessGate
      permission={permission}
      permissions={permissions}
      requireAll={true}
      fallback={fallback}
    >
      {children}
    </AccessGate>
  );
}

/**
 * Componente per mostrare contenuto solo agli admin
 * Shortcut per permission checking
 *
 * @example
 * ```tsx
 * <AdminOnly>
 *   <AdminPanel />
 * </AdminOnly>
 * ```
 */
export function AdminOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}): ReactNode {
  const { isAdmin } = useAccess();
  return isAdmin() ? <>{children}</> : <>{fallback}</>;
}

/**
 * Componente per mostrare contenuto solo ad admin e editor
 * Shortcut per permission checking
 *
 * @example
 * ```tsx
 * <AdminOrEditorOnly>
 *   <EditButton />
 * </AdminOrEditorOnly>
 * ```
 */
export function AdminOrEditorOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}): ReactNode {
  const { isAdminOrEditor } = useAccess();
  return isAdminOrEditor() ? <>{children}</> : <>{fallback}</>;
}
