import { Roles, type Role } from '@luke/core';

/** Display label of each role. */
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

/** Privilege rank of each role: keyed by `Role`, so a new role must be ranked. */
const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2 };

/** The roles from the least privileged: the order a role picker offers them in. */
export const ROLES_LEAST_FIRST: readonly Role[] = [...Roles].sort((a, b) => ROLE_RANK[a] - ROLE_RANK[b]);

/** The role a form control's string value names, or `undefined` for any other string. */
export function parseRole(value: string): Role | undefined {
  return Roles.find(role => role === value);
}
