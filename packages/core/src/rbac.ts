/**
 * Modulo RBAC (Role-Based Access Control)
 * Gestisce i ruoli e le permissions del sistema Luke
 */

/**
 * Ruoli disponibili nel sistema
 */
export const Roles = ['admin', 'editor', 'viewer'] as const;

/**
 * Tipo TypeScript per i ruoli
 */
export type Role = (typeof Roles)[number];

/**
 * Mapping delle permissions per ruolo e risorsa
 * Struttura granulare: ruolo -> risorsa -> azioni permesse
 */
export const permissions: Record<Role, Record<string, string[]>> = {
  admin: {
    users: ['*'],
    config: ['*'],
    pricing: ['*'],
    audit: ['*'],
    dashboard: ['*'], // NEW: dashboard access
    settings: ['*'], // NEW
    maintenance: ['*'], // NEW
  },
  editor: {
    users: ['read', 'update'],
    config: ['read', 'update'],
    pricing: ['read', 'write'],
    audit: ['read'],
    dashboard: ['read'], // NEW: dashboard access
    settings: ['read'], // NEW
    maintenance: [], // NEW: no access
  },
  viewer: {
    users: ['read'],
    config: ['read'],
    pricing: ['read'],
    audit: ['read'],
    dashboard: ['read'], // NEW: dashboard access
    settings: [], // NEW: no access
    maintenance: [], // NEW: no access
  },
};

/**
 * Verifica se un ruolo può eseguire un'azione su una risorsa specifica
 *
 * @param role - Il ruolo dell'utente
 * @param resource - La risorsa su cui si vuole agire
 * @param action - L'azione da eseguire
 * @returns true se l'azione è permessa, false altrimenti
 *
 * @example
 * ```typescript
 * canPerform('editor', 'users', 'read') // true
 * canPerform('viewer', 'users', 'delete') // false
 * canPerform('admin', 'config', 'write') // true (wildcard *)
 * ```
 */
export function canPerform(
  role: Role,
  resource: string,
  action: string
): boolean {
  const rolePermissions = permissions[role];

  if (!rolePermissions) {
    return false;
  }

  const resourcePermissions = rolePermissions[resource];

  if (!resourcePermissions) {
    return false;
  }

  // Controlla se ha wildcard (tutti i permessi)
  if (resourcePermissions.includes('*')) {
    return true;
  }

  // Controlla se l'azione specifica è permessa
  return resourcePermissions.includes(action);
}

/**
 * Ottiene tutte le permissions per un ruolo specifico
 *
 * @param role - Il ruolo di cui ottenere le permissions
 * @returns Record con tutte le permissions del ruolo
 */
export function getRolePermissions(role: Role): Record<string, string[]> {
  return permissions[role] || {};
}

/**
 * Verifica se un ruolo esiste nel sistema
 *
 * @param role - Il ruolo da verificare
 * @returns true se il ruolo esiste, false altrimenti
 */
export function isValidRole(role: string): role is Role {
  return Roles.includes(role as Role);
}
