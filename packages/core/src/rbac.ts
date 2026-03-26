/**
 * Modulo RBAC (Role-Based Access Control) — Definizione ruoli
 *
 * Le permission granulari Resource:Action sono in auth/permissions.ts.
 * Le sezioni e i loro mapping sono in schemas/rbac.ts.
 */

/**
 * Ruoli disponibili nel sistema
 */
export const Roles = ['admin', 'editor', 'viewer'] as const;

/**
 * Tipo TypeScript per i ruoli
 */
export type Role = (typeof Roles)[number];
