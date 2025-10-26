/**
 * Sistema di permissions Resource:Action per Luke
 *
 * Implementa un modello granulare di access control dove ogni permission
 * è definita come `${Resource}:${Action}` (es. 'brands:create', 'users:read').
 *
 * Supporta wildcard matching per scalabilità:
 * - `*:*` = tutti i permessi (admin)
 * - `resource:*` = tutte le azioni su una risorsa (es. 'brands:*')
 * - `resource:action` = azione specifica (es. 'brands:create')
 */

import type { Role } from '../rbac';

/**
 * Risorse disponibili nel sistema Luke
 * Ogni risorsa rappresenta un'entità o area funzionale
 */
export type Resource =
  | 'brands'
  | 'seasons'
  | 'users'
  | 'config'
  | 'audit'
  | 'settings'
  | 'maintenance'
  | 'dashboard';

/**
 * Azioni disponibili sulle risorse
 * '*' rappresenta wildcard per tutte le azioni
 */
export type Action = 'create' | 'read' | 'update' | 'delete' | 'upload' | '*';

/**
 * Permission = Resource:Action
 * Esempi: 'brands:create', 'users:read', 'settings:*', '*:*'
 */
export type Permission = `${Resource}:${Action}` | '*:*';

/**
 * Context per Attribute-Based Access Control (ABAC)
 * Placeholder per implementazioni future (ownership, team-based access)
 */
export interface PermissionContext {
  brandId?: string;
  seasonId?: string;
  teamId?: string;
}

/**
 * Mapping delle permissions per ruolo
 * Definisce le permissions di base per ogni ruolo nel sistema
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    '*:*', // Wildcard totale - accesso completo
  ],
  editor: [
    // Brands: accesso completo
    'brands:*',
    // Seasons: accesso completo
    'seasons:*',
    // Users: lettura e modifica (no delete)
    'users:read',
    'users:update',
    // Config: lettura e modifica
    'config:read',
    'config:update',
    // Audit: solo lettura
    'audit:read',
    // Dashboard: lettura
    'dashboard:read',
    // Settings: lettura
    'settings:read',
  ],
  viewer: [
    // Brands: solo lettura
    'brands:read',
    // Seasons: solo lettura
    'seasons:read',
    // Users: solo lettura
    'users:read',
    // Config: solo lettura
    'config:read',
    // Audit: solo lettura
    'audit:read',
    // Dashboard: lettura
    'dashboard:read',
  ],
};

/**
 * Verifica se un utente ha una permission specifica
 *
 * @param user - Oggetto utente con ruolo
 * @param permission - Permission da verificare (es. 'brands:create')
 * @param context - Context opzionale per ABAC (futuro)
 * @returns true se l'utente ha la permission, false altrimenti
 *
 * @example
 * ```typescript
 * hasPermission({role: 'editor'}, 'brands:create') // true
 * hasPermission({role: 'viewer'}, 'brands:delete') // false
 * hasPermission({role: 'admin'}, 'users:read') // true (wildcard)
 * ```
 */
export function hasPermission(
  user: { role: Role },
  permission: Permission,
  context?: PermissionContext
): boolean {
  const userPermissions = ROLE_PERMISSIONS[user.role];

  if (!userPermissions) {
    return false;
  }

  // 1. Controlla wildcard totale (*:*)
  if (userPermissions.includes('*:*' as Permission)) {
    return true;
  }

  // 2. Controlla wildcard per risorsa (resource:*)
  const [resource] = permission.split(':') as [Resource, Action];
  const resourceWildcard = `${resource}:*` as Permission;

  if (userPermissions.includes(resourceWildcard)) {
    return true;
  }

  // 3. Controlla permission specifica
  return userPermissions.includes(permission);
}

/**
 * Espande un ruolo nelle sue permissions specifiche
 * Utile per debug, UI e audit
 *
 * @param role - Ruolo da espandere
 * @returns Array di permissions specifiche (senza wildcard)
 *
 * @example
 * ```typescript
 * expandRole('editor')
 * // ['brands:create', 'brands:read', 'brands:update', 'brands:delete', ...]
 * ```
 */
export function expandRole(role: Role): Permission[] {
  const rolePermissions = ROLE_PERMISSIONS[role];

  if (!rolePermissions) {
    return [];
  }

  // Se ha wildcard totale, espandi a tutte le permissions possibili
  if (rolePermissions.includes('*:*' as Permission)) {
    const resources: Resource[] = [
      'brands',
      'seasons',
      'users',
      'config',
      'audit',
      'settings',
      'maintenance',
      'dashboard',
    ];
    const actions: Action[] = ['create', 'read', 'update', 'delete', 'upload'];

    return resources.flatMap(resource =>
      actions.map(action => `${resource}:${action}` as Permission)
    );
  }

  // Espandi wildcard per risorsa
  const expanded: Permission[] = [];

  for (const permission of rolePermissions) {
    if (permission.endsWith(':*')) {
      const resource = permission.slice(0, -2) as Resource;
      const actions: Action[] = [
        'create',
        'read',
        'update',
        'delete',
        'upload',
      ];

      expanded.push(
        ...actions.map(action => `${resource}:${action}` as Permission)
      );
    } else {
      expanded.push(permission);
    }
  }

  return expanded;
}

/**
 * Verifica se una permission è valida
 *
 * @param permission - Permission da validare
 * @returns true se la permission è nel formato corretto
 */
export function isValidPermission(
  permission: string
): permission is Permission {
  const [resource, action] = permission.split(':');

  const validResources: Resource[] = [
    'brands',
    'seasons',
    'users',
    'config',
    'audit',
    'settings',
    'maintenance',
    'dashboard',
  ];
  const validActions: Action[] = [
    'create',
    'read',
    'update',
    'delete',
    'upload',
    '*',
  ];

  return (
    validResources.includes(resource as Resource) &&
    validActions.includes(action as Action)
  );
}

/**
 * Helper per creare permission string
 *
 * @param resource - Risorsa
 * @param action - Azione
 * @returns Permission string formattata
 */
export function createPermission(
  resource: Resource,
  action: Action
): Permission {
  return `${resource}:${action}` as Permission;
}

/**
 * Configurazione permissions esportata per test e debugging
 */
export const PERMISSIONS_CONFIG = {
  resources: [
    'brands',
    'seasons',
    'users',
    'config',
    'audit',
    'settings',
    'maintenance',
    'dashboard',
  ] as const,
  actions: ['create', 'read', 'update', 'delete', 'upload', '*'] as const,
  rolePermissions: ROLE_PERMISSIONS,
} as const;
