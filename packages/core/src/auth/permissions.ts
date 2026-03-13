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

/**
 * Validazione delle risorse - ogni risorsa ha azioni valide
 */
export type ResourceMap = Record<Resource, readonly Action[]>;

export const VALID_RESOURCE_ACTIONS: ResourceMap = {
  [RESOURCES.BRANDS]: ['create', 'read', 'update', 'delete'] as const,
  [RESOURCES.SEASONS]: ['create', 'read', 'update', 'delete'] as const,
  [RESOURCES.USERS]: ['create', 'read', 'update', 'delete'] as const,
  [RESOURCES.CONFIG]: ['read', 'update'] as const,
  [RESOURCES.AUDIT]: ['read'] as const,
  [RESOURCES.SETTINGS]: ['read', 'update'] as const,
  [RESOURCES.MAINTENANCE]: ['read', 'update'] as const,
  [RESOURCES.DASHBOARD]: ['read'] as const,
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
 * Type guard: verifica se una stringa è una Resource valida
 *
 * @param value - Valore da verificare
 * @returns true se è una Resource valida
 */
export function isResource(value: string): value is Resource {
  return Object.values(RESOURCES).includes(value as Resource);
}

/**
 * Type guard: verifica se una stringa è una Action valida
 *
 * @param value - Valore da verificare
 * @returns true se è una Action valida
 */
export function isAction(value: string): value is Action {
  if (value === '*') {
    return true;
  }
  const actions = Object.values(ACTIONS);
  return actions.includes(value as (typeof actions)[number]);
}

/**
 * Type guard: verifica se una stringa è una Permission valida
 * Valida sia il formato resource:action che i valori specifici per resource
 *
 * @param value - Valore da verificare
 * @returns true se la permission è valida
 */
export function isPermission(value: string): value is Permission {
  if (value === '*:*') {
    return true;
  }

  const [resource, action] = value.split(':');

  if (!resource || !action) {
    return false;
  }

  // Valida che resource sia una Resource conosciuta
  if (!isResource(resource)) {
    return false;
  }

  // Se action è *, accetta per qualsiasi resource
  if (action === '*') {
    return true;
  }

  // Valida che l'action sia valida per questo resource
  if (!isAction(action)) {
    return false;
  }

  // Verifica che l'action sia nella lista di azioni valide per il resource
  const validActions = VALID_RESOURCE_ACTIONS[resource as Resource];
  return validActions.includes(action as Action);
}

/**
 * Verifica se una permission è valida (backward compatibility)
 * @deprecated Usa isPermission() invece
 */
export function isValidPermission(
  permission: string
): permission is Permission {
  return isPermission(permission);
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
 * Verifica se un utente ha una permission considerando sia ruolo che grants espliciti
 * Integra ROLE_PERMISSIONS con UserGrantedPermission dal database
 *
 * @param user - Oggetto utente con ruolo e id
 * @param permission - Permission da verificare (es. 'brands:create')
 * @param userGrants - Array di permissions concesse esplicitamente (da UserGrantedPermission)
 * @param context - Context opzionale per ABAC (futuro)
 * @returns true se l'utente ha la permission
 *
 * @example
 * ```typescript
 * hasPermissionWithGrants({role: 'viewer', id: 'user1'}, 'brands:create', ['brands:create'])
 * // true - ha permission esplicita anche se viewer normalmente non potrebbe creare
 * ```
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

/**
 * Elenco di tutte le permissions possibili nel sistema
 * Generato dal cartesiano di resources × actions validi
 */
export function getAllPermissions(): Permission[] {
  const all: Permission[] = ['*:*'];

  for (const [resource, actions] of Object.entries(VALID_RESOURCE_ACTIONS)) {
    // Aggiungi wildcard per risorsa
    all.push(`${resource}:*` as Permission);

    // Aggiungi azioni specifiche
    for (const action of actions) {
      all.push(`${resource}:${action}` as Permission);
    }
  }

  return all;
}

/**
 * Interfaccia per la matrice di permissions
 */
export interface PermissionMatrix {
  resources: Resource[];
  actions: Action[];
  validResourceActions: Record<Resource, Action[]>;
  rolePermissions: Record<Role, Permission[]>;
  expandedRolePermissions: Record<Role, Permission[]>;
  allPermissions: Permission[];
}

/**
 * Esporta la matrice completa di permissions per debugging, audit, e documentazione
 *
 * @returns Struttura completa della matrice di permissions
 */
export function getPermissionMatrix(): PermissionMatrix {
  const allPerms = getAllPermissions();

  // Costruisci validResourceActions preservando i tipi
  const validResourceActions: Record<Resource, Action[]> = {} as Record<
    Resource,
    Action[]
  >;
  for (const [resource, actions] of Object.entries(VALID_RESOURCE_ACTIONS)) {
    validResourceActions[resource as Resource] = [...actions];
  }

  // Costruisci rolePermissions preservando i tipi
  const rolePermissions: Record<Role, Permission[]> = {} as Record<
    Role,
    Permission[]
  >;
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    rolePermissions[role as Role] = [...perms];
  }

  return {
    resources: Object.values(RESOURCES),
    actions: Object.values(ACTIONS),
    validResourceActions,
    rolePermissions,
    expandedRolePermissions: {
      admin: expandRole('admin'),
      editor: expandRole('editor'),
      viewer: expandRole('viewer'),
    },
    allPermissions: allPerms,
  };
}

/**
 * Valida la coerenza della matrice di permissions
 * Controlla che:
 * - Tutte le permissions in ROLE_PERMISSIONS siano valide
 * - Nessun resource/action ricevano azioni non dichiarate
 * - Non ci siano gaps nelle definizioni
 *
 * @returns { valid: boolean; errors: string[] }
 */
export function validatePermissionMatrix(): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // 1. Valida ROLE_PERMISSIONS
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    for (const permission of permissions) {
      if (!isPermission(permission)) {
        errors.push(`Role '${role}' ha permission invalida '${permission}'`);
      }
    }
  }

  // 2. Valida VALID_RESOURCE_ACTIONS
  for (const [resource, actions] of Object.entries(VALID_RESOURCE_ACTIONS)) {
    if (!isResource(resource)) {
      errors.push(
        `VALID_RESOURCE_ACTIONS contiene resource invalida '${resource}'`
      );
    }

    for (const action of actions) {
      if (!isAction(action)) {
        errors.push(`Resource '${resource}' ha action invalida '${action}'`);
      }
    }
  }

  // 3. Controlla che ogni Resource in RESOURCES abbia un entry in VALID_RESOURCE_ACTIONS
  for (const resource of Object.values(RESOURCES)) {
    if (!(resource in VALID_RESOURCE_ACTIONS)) {
      errors.push(
        `Resource '${resource}' non ha entry in VALID_RESOURCE_ACTIONS`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Esporta la matrice di permissions in formato CSV per documentazione
 * Formato: Resource,Action,Admin,Editor,Viewer
 *
 * @returns String CSV con header e dati
 */
export function permissionMatrixToCSV(): string {
  const lines: string[] = ['Resource,Action,Admin,Editor,Viewer'];

  const expandedAdmin = expandRole('admin');
  const expandedEditor = expandRole('editor');
  const expandedViewer = expandRole('viewer');

  for (const resource of Object.values(RESOURCES)) {
    const actions = VALID_RESOURCE_ACTIONS[resource];

    for (const action of actions) {
      const perm = `${resource}:${action}` as Permission;

      const adminHas = expandedAdmin.includes(perm);
      const editorHas = expandedEditor.includes(perm);
      const viewerHas = expandedViewer.includes(perm);

      lines.push(
        `"${resource}","${action}",${adminHas ? 'Yes' : 'No'},${editorHas ? 'Yes' : 'No'},${viewerHas ? 'Yes' : 'No'}`
      );
    }
  }

  return lines.join('\n');
}

/**
 * Configurazione permissions esportata per test e debugging
 */
export const PERMISSIONS_CONFIG = {
  resources: Object.values(RESOURCES),
  actions: ['create', 'read', 'update', 'delete', 'upload', '*'] as const,
  rolePermissions: ROLE_PERMISSIONS,
  validResourceActions: VALID_RESOURCE_ACTIONS,
  getMatrix: getPermissionMatrix,
  validateMatrix: validatePermissionMatrix,
  toCSV: permissionMatrixToCSV,
} as const;
