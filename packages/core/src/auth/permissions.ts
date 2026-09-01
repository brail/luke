/**
 * Resource:Action permission system for Luke
 *
 * Implements a granular access control model where each permission
 * is defined as `${Resource}:${Action}` (e.g. 'brands:create', 'users:read').
 *
 * Supports wildcard matching for scalability:
 * - `*:*` = all permissions (admin)
 * - `resource:*` = all actions on a resource (e.g. 'brands:*')
 * - `resource:action` = specific action (e.g. 'brands:create')
 */

import type { Role } from '../rbac.js';

/**
 * Available resources in the Luke system. Each entry represents a functional entity or domain area.
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
  VENDORS: 'vendors',
  SALES: 'sales',
  MERCHANDISING_PLAN: 'merchandising_plan',
  SEASON_CALENDAR: 'season_calendar',
  MILESTONE_TEMPLATE: 'milestone_template',
  PHASE_CATALOG: 'phase_catalog',
  COLLECTION_ALERT: 'collection_alert',
  COMPANY_PROFILE: 'company_profile',
  COMPANY_FUNCTION: 'company_function',
  COMPANY_TEAM: 'company_team',
} as const;

/** Union of all valid resource string values (e.g. `'brands'`, `'users'`). */
export type Resource = (typeof RESOURCES)[keyof typeof RESOURCES];

/**
 * Available actions on resources. `'*'` is the wildcard matching all actions.
 */
export const ACTIONS = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  UPLOAD: 'upload',
  SYNC: 'sync',
  EXPORT: 'export',
  REVISE: 'revise',
  VIEW_REVISIONS: 'view_revisions',
  FREEZE: 'freeze',
  UNFREEZE: 'unfreeze',
  UNCANCEL: 'uncancel',
  BACKUP_CREATE: 'backup_create',
  BACKUP_RESTORE: 'backup_restore',
  BACKUP_DELETE: 'backup_delete',
  BACKUP_EXPORT: 'backup_export',
  MODE_MANAGE: 'mode_manage',
  READ_ALL: 'read_all',
} as const;

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS] | '*';

/**
 * A typed permission string in `Resource:Action` form.
 *
 * @example 'brands:create' | 'users:read' | 'settings:*' | '*:*'
 */
export type Permission = `${Resource}:${Action}` | '*:*';

/**
 * Declarative permission requirement for an endpoint, used for documentation and tooling.
 */
export interface PermissionDeclaration {
  required: Permission | Permission[];
  description: string;
}

/** Allowlist of valid actions per resource. Used to expand wildcards and validate permission strings. */
export const VALID_RESOURCE_ACTIONS: Record<Resource, readonly Action[]> = {
  [RESOURCES.BRANDS]: ['create', 'read', 'update', 'delete'] as const,
  [RESOURCES.SEASONS]: ['create', 'read', 'update', 'delete'] as const,
  [RESOURCES.USERS]: ['create', 'read', 'update', 'delete'] as const,
  [RESOURCES.CONFIG]: ['read', 'update'] as const,
  [RESOURCES.AUDIT]: ['read', 'read_all'] as const,
  [RESOURCES.SETTINGS]: ['read', 'update'] as const,
  [RESOURCES.MAINTENANCE]: ['read', 'update', 'backup_create', 'backup_restore', 'backup_delete', 'backup_export', 'mode_manage'] as const,
  [RESOURCES.DASHBOARD]: ['read'] as const,
  [RESOURCES.PRICING]: ['read', 'update'] as const,
  [RESOURCES.COLLECTION_LAYOUT]: ['read', 'update', 'revise', 'view_revisions'] as const,
  [RESOURCES.VENDORS]: ['create', 'read', 'update', 'delete'] as const,
  [RESOURCES.SALES]: ['read'] as const,
  [RESOURCES.MERCHANDISING_PLAN]: ['create', 'read', 'update', 'delete'] as const,
  [RESOURCES.SEASON_CALENDAR]: ['create', 'read', 'update', 'delete', 'sync', 'export', 'freeze', 'unfreeze', 'uncancel'] as const,
  [RESOURCES.MILESTONE_TEMPLATE]: ['create', 'read', 'update', 'delete'] as const,
  [RESOURCES.PHASE_CATALOG]: ['read', 'update'] as const,
  [RESOURCES.COLLECTION_ALERT]: ['read'] as const,
  [RESOURCES.COMPANY_PROFILE]: ['read', 'update'] as const,
  [RESOURCES.COMPANY_FUNCTION]: ['create', 'read', 'update', 'delete'] as const,
  [RESOURCES.COMPANY_TEAM]: ['create', 'read', 'update', 'delete'] as const,
} as const;

/**
 * Base permission set for each role. Admin receives `*:*` wildcard; editor and viewer
 * receive explicit resource:action grants. Used by `hasPermission` and `expandRole`.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  admin: [
    '*:*', // Complete wildcard - full access
  ],
  editor: [
    // Brands: full access
    'brands:*',
    // Seasons: full access
    'seasons:*',
    // Users: read and update (no delete)
    'users:read',
    'users:update',
    // Config: none. `config:update` gates 27 endpoints — SMTP, LDAP, the auth strategy, Google
    // OAuth and S3 credentials, the password policy — and only one of them also checks section
    // access, so the `settings: false` an editor has in SECTION_ACCESS_DEFAULTS only ever hid the
    // pages, never the endpoints behind them. The two layers CLAUDE.md requires to stay in sync
    // disagreed, and RBAC was the permissive one.
    // Audit: read-only
    'audit:read',
    // Dashboard: read
    'dashboard:read',
    // Pricing: read-only (variant updates reserved for admin)
    'pricing:read',
    // Collection Layout: read, update, revisions
    'collection_layout:read',
    'collection_layout:update',
    'collection_layout:revise',
    'collection_layout:view_revisions',
    // Vendors: full access
    'vendors:*',
    // Sales: read statistics
    'sales:read',
    // Merchandising Plan: read and update
    'merchandising_plan:read',
    'merchandising_plan:update',
    // Season Calendar: read, update, export, freeze
    'season_calendar:read',
    'season_calendar:update',
    'season_calendar:export',
    'season_calendar:freeze',
    // Milestone Template: read-only
    'milestone_template:read',
    // Phase Catalog: read-only (updates reserved for admin, separate domain from calendar)
    'phase_catalog:read',
    // Collection Alert: read alert engine (criticality, planning deviation)
    'collection_alert:read',
    // Company structure: read-only (for dropdowns and badges)
    'company_profile:read',
    'company_function:read',
    'company_team:read',
  ],
  viewer: [
    // Brands: read-only
    'brands:read',
    // Seasons: read-only
    'seasons:read',
    // Users: read-only
    'users:read',
    // Config: none, same reason as the editor above — the settings endpoints it gates do not check
    // section access, so the permission reached further than the hidden pages suggested.
    // Audit: read-only
    'audit:read',
    // Dashboard: read
    'dashboard:read',
    // Pricing: read-only
    'pricing:read',
    // Collection Layout: read + revision history
    'collection_layout:read',
    'collection_layout:view_revisions',
    // Vendors: read-only
    'vendors:read',
    // Sales: read statistics
    'sales:read',
    // Merchandising Plan: read-only
    'merchandising_plan:read',
    // Season Calendar: read, export
    'season_calendar:read',
    'season_calendar:export',
    // Milestone Template: read-only
    'milestone_template:read',
    // Phase Catalog: read-only
    'phase_catalog:read',
    // Collection Alert: read alert engine
    'collection_alert:read',
    // Company structure: read-only
    'company_profile:read',
    'company_function:read',
    'company_team:read',
  ],
};

/**
 * Checks if a user has a specific permission
 *
 * @param user - User object with role
 * @param permission - Permission to verify (e.g. 'brands:create')
 * @param context - Optional context for ABAC (future)
 * @returns true if the user has the permission, false otherwise
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
  permission: Permission
): boolean {
  const userPermissions = ROLE_PERMISSIONS[user.role];

  if (!userPermissions) {
    return false;
  }

  // 1. Check total wildcard (*:*)
  if (userPermissions.includes('*:*' as Permission)) {
    return true;
  }

  // 2. Check resource wildcard (resource:*)
  const [resource] = permission.split(':') as [Resource, Action];
  const resourceWildcard = `${resource}:*` as Permission;

  if (userPermissions.includes(resourceWildcard)) {
    return true;
  }

  // 3. Check specific permission
  return userPermissions.includes(permission);
}

/**
 * Expands a role into its specific permissions
 * Useful for debug, UI and audit
 *
 * @param role - Role to expand
 * @returns Array of specific permissions (without wildcards)
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

  // If it has total wildcard, expand to all valid permissions per resource
  if (rolePermissions.includes('*:*' as Permission)) {
    return Object.entries(VALID_RESOURCE_ACTIONS).flatMap(([resource, actions]) =>
      (actions as readonly Action[]).map(action => `${resource}:${action}` as Permission),
    );
  }

  // Expand resource wildcard using only valid actions for that resource
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

/** Returns `true` if `v` is a known `Resource` value. */
export function isResource(v: unknown): v is Resource {
  return typeof v === 'string' && RESOURCE_VALUES.includes(v);
}

/** Returns `true` if `v` is a known `Action` value (including `'*'`). */
export function isAction(v: unknown): v is Action {
  return typeof v === 'string' && ACTION_VALUES.includes(v);
}

/**
 * Returns `true` if `v` is a structurally valid `Permission` string.
 * Validates that the resource is known and the action is valid for that resource.
 */
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

/** Returns all valid permissions including wildcards (`*:*`, `resource:*`) and specific grants. */
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

/** Returns a complete snapshot of the permission matrix for inspection and debugging. */
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

/**
 * Validates the integrity of the permission matrix.
 *
 * @returns `{ valid: true }` when no issues are found, or `{ valid: false, errors }` listing problems.
 */
export function validatePermissionMatrix(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Each resource must have at least one valid action
  for (const resource of Object.values(RESOURCES)) {
    const actions = VALID_RESOURCE_ACTIONS[resource as Resource];
    if (!actions || actions.length === 0) {
      errors.push(`Resource '${resource}' has no valid actions`);
    }
  }

  // Each resource in VALID_RESOURCE_ACTIONS must correspond to a defined resource
  for (const resource of Object.keys(VALID_RESOURCE_ACTIONS)) {
    if (!isResource(resource)) {
      errors.push(`VALID_RESOURCE_ACTIONS references unknown resource '${resource}'`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Serializes the permission matrix to CSV with columns: Resource, Action, Admin, Editor, Viewer. */
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

/** Builds a typed `Permission` string from a resource and action. */
export function createPermission(resource: Resource, action: Action): Permission {
  return `${resource}:${action}` as Permission;
}

