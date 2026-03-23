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
 * Risorse disponibili nel sistema Luke - Const Enum
 * Ogni risorsa rappresenta un'entità o area funzionale
 */
export const RESOURCES = {
  BRANDS: 'brands',
  SEASONS: 'seasons',
  USERS: 'users',
  CONFIG: 'config',
  AUDIT: 'audit',
  SETTINGS: 'settings',
  MAINTENANCE: 'maintenance',
  DASHBOARD: 'dashboard',
  PRICING: 'pricing',
  COLLECTION_LAYOUT: 'collection_layout',
} as const;

export type Resource = (typeof RESOURCES)[keyof typeof RESOURCES];

/**
 * Azioni disponibili sulle risorse - Const Enum
 * '*' rappresenta wildcard per tutte le azioni
 */
export const ACTIONS = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  UPLOAD: 'upload',
} as const;

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS] | '*';

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
 * Dichiarazione di permission per un endpoint
 * Specifica le permissions richieste e il contesto di validazione
 */
export interface PermissionDeclaration {
  required: Permission | Permission[];
  description: string;
  context?: {
    checkOwnership?: boolean; // Verifica solo il tuo dato
    requireAdmin?: boolean; // Che sia admin
  };
}

export const VALID_RESOURCE_ACTIONS: Record<Resource, readonly Action[]> = {
  [RESOURCES.BRANDS]: ['create', 'read', 'update', 'delete'] as const,
  [RESOURCES.SEASONS]: ['create', 'read', 'update', 'delete'] as const,
  [RESOURCES.USERS]: ['create', 'read', 'update', 'delete'] as const,
  [RESOURCES.CONFIG]: ['read', 'update'] as const,
  [RESOURCES.AUDIT]: ['read'] as const,
  [RESOURCES.SETTINGS]: ['read', 'update'] as const,
  [RESOURCES.MAINTENANCE]: ['read', 'update'] as const,
  [RESOURCES.DASHBOARD]: ['read'] as const,
  [RESOURCES.PRICING]: ['read', 'update'] as const,
  [RESOURCES.COLLECTION_LAYOUT]: ['read', 'update'] as const,
} as const;

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
    // Pricing: solo lettura (modifica varianti riservata ad admin)
    'pricing:read',
    // Collection Layout: lettura e modifica
    'collection_layout:read',
    'collection_layout:update',
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
    // Pricing: solo lettura
    'pricing:read',
    // Collection Layout: solo lettura
    'collection_layout:read',
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

  // Se ha wildcard totale, espandi a tutte le permissions valide per risorsa
  if (rolePermissions.includes('*:*' as Permission)) {
    return Object.entries(VALID_RESOURCE_ACTIONS).flatMap(([resource, actions]) =>
      (actions as readonly Action[]).map(action => `${resource}:${action}` as Permission),
    );
  }

  // Espandi wildcard per risorsa usando solo le azioni valide per quella risorsa
  const expanded: Permission[] = [];

  for (const permission of rolePermissions) {
    if (permission.endsWith(':*')) {
      const resource = permission.slice(0, -2) as Resource;
      const actions = VALID_RESOURCE_ACTIONS[resource] ?? [];
      expanded.push(...(actions as readonly Action[]).map(action => `${resource}:${action}` as Permission));
    } else {
      expanded.push(permission);
    }
  }

  return expanded;
}


// ── Type guards ──────────────────────────────────────────────────────────────

const RESOURCE_VALUES = Object.values(RESOURCES) as string[];
const ACTION_VALUES: string[] = [...Object.values(ACTIONS), '*'];

export function isResource(v: unknown): v is Resource {
  return typeof v === 'string' && RESOURCE_VALUES.includes(v);
}

export function isAction(v: unknown): v is Action {
  return typeof v === 'string' && ACTION_VALUES.includes(v);
}

export function isPermission(v: unknown): v is Permission {
  if (typeof v !== 'string') return false;
  if (v === '*:*') return true;

  const parts = v.split(':');
  if (parts.length !== 2) return false;

  const [resource, action] = parts;
  if (!isResource(resource)) return false;

  // resource:* wildcard
  if (action === '*') return true;

  // resource:action — must be in VALID_RESOURCE_ACTIONS for that resource
  const validActions = VALID_RESOURCE_ACTIONS[resource as Resource] as readonly string[];
  return validActions.includes(action);
}

// ── Matrix utilities ──────────────────────────────────────────────────────────

/** Restituisce tutte le permissions valide (wildcards + specifiche) */
export function getAllPermissions(): Permission[] {
  const result: Permission[] = ['*:*'];

  for (const resource of Object.values(RESOURCES)) {
    result.push(`${resource}:*` as Permission);
    const actions = VALID_RESOURCE_ACTIONS[resource as Resource];
    for (const action of actions) {
      result.push(`${resource}:${action}` as Permission);
    }
  }

  return result;
}

/** Restituisce una struttura completa per ispezione/debug della matrice */
export function getPermissionMatrix(): {
  resources: Resource[];
  actions: Action[];
  validResourceActions: typeof VALID_RESOURCE_ACTIONS;
  rolePermissions: typeof ROLE_PERMISSIONS;
  expandedRolePermissions: Record<Role, Permission[]>;
  allPermissions: Permission[];
} {
  const roles: Role[] = ['admin', 'editor', 'viewer'];
  const expandedRolePermissions = Object.fromEntries(
    roles.map(role => [role, expandRole(role)]),
  ) as Record<Role, Permission[]>;

  return {
    resources: Object.values(RESOURCES) as Resource[],
    actions: Object.values(ACTIONS) as Action[],
    validResourceActions: VALID_RESOURCE_ACTIONS,
    rolePermissions: ROLE_PERMISSIONS,
    expandedRolePermissions,
    allPermissions: getAllPermissions(),
  };
}

/** Valida l'integrità della matrice di permissions */
export function validatePermissionMatrix(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Ogni risorsa deve avere almeno un'azione valida
  for (const resource of Object.values(RESOURCES)) {
    const actions = VALID_RESOURCE_ACTIONS[resource as Resource];
    if (!actions || actions.length === 0) {
      errors.push(`Resource '${resource}' has no valid actions`);
    }
  }

  // Ogni resource in VALID_RESOURCE_ACTIONS deve corrispondere a una risorsa definita
  for (const resource of Object.keys(VALID_RESOURCE_ACTIONS)) {
    if (!isResource(resource)) {
      errors.push(`VALID_RESOURCE_ACTIONS references unknown resource '${resource}'`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Esporta la matrice in formato CSV (Resource,Action,Admin,Editor,Viewer) */
export function permissionMatrixToCSV(): string {
  const roles: Role[] = ['admin', 'editor', 'viewer'];
  const rows: string[] = ['Resource,Action,Admin,Editor,Viewer'];

  for (const resource of Object.values(RESOURCES) as Resource[]) {
    const actions = VALID_RESOURCE_ACTIONS[resource];
    for (const action of actions) {
      const perm = `${resource}:${action}` as Permission;
      const cols = roles.map(role => {
        const user = { role, id: '' };
        return hasPermission(user, perm) ? 'Yes' : 'No';
      });
      rows.push([`"${resource}"`, `"${action}"`, ...cols].join(','));
    }
  }

  return rows.join('\n');
}

/** Crea una stringa di permission tipizzata da resource e action */
export function createPermission(resource: Resource, action: Action): Permission {
  return `${resource}:${action}` as Permission;
}

/**
 * Verifica se un utente ha una permission considerando sia ruolo che grants espliciti
 * Integra ROLE_PERMISSIONS con UserGrantedPermission dal database
 */
export function hasPermissionWithGrants(
  user: { role: Role; id: string },
  permission: Permission,
  userGrants?: string[],
  context?: PermissionContext
): boolean {
  // 1. Controlla prima il ruolo (faster path)
  if (hasPermission(user, permission, context)) {
    return true;
  }

  // 2. Se non ha per ruolo, controlla grants espliciti
  if (userGrants && userGrants.length > 0) {
    // Controlla wildcard totale
    if (userGrants.includes('*:*')) {
      return true;
    }

    // Controlla wildcard per risorsa
    const [resource] = permission.split(':') as [Resource, Action];
    const resourceWildcard = `${resource}:*`;
    if (userGrants.includes(resourceWildcard)) {
      return true;
    }

    // Controlla permission specifica
    if (userGrants.includes(permission)) {
      return true;
    }
  }

  return false;
}
