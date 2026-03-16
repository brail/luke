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
    audit: ['*'],
    dashboard: ['*'],
    settings: ['*'],
    maintenance: ['*'],
  },
  editor: {
    users: ['read', 'update'],
    config: ['read', 'update'],
    audit: ['read'],
    dashboard: ['read'],
    settings: ['read'],
    maintenance: [],
  },
  viewer: {
    users: ['read'],
    config: ['read'],
    audit: ['read'],
    dashboard: ['read'],
    settings: [],
    maintenance: [],
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
