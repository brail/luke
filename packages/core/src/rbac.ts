/**
 * RBAC (Role-Based Access Control) — role definitions.
 *
 * Granular Resource:Action permissions are defined in `auth/permissions.ts`.
 * Section keys and their mappings live in `schemas/rbac.ts`.
 */

/** All valid roles in the system. */
export const Roles = ['admin', 'editor', 'viewer'] as const;

/** Union type of all valid role values. */
export type Role = (typeof Roles)[number];
