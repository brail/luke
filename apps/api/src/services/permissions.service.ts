/**
 * Service per gestire permissions a livello database
 * Gestisce UserGrantedPermission e PermissionAudit
 */

import type { PrismaClient } from '@prisma/client';
import { type Role, type Permission, hasPermission } from '@luke/core';

/**
 * Carica i grants espliciti di un utente dal database
 *
 * @param prisma - Client Prisma
 * @param userId - ID utente
 * @returns Array di permissions concesse esplicitamente
 */
export async function loadUserGrants(
  prisma: PrismaClient,
  userId: string
): Promise<string[]> {
  const grants = await prisma.userGrantedPermission.findMany({
    where: {
      userId,
      OR: [
        { expiresAt: null }, // No expiration
        { expiresAt: { gt: new Date() } }, // Not expired
      ],
    },
    select: { permission: true },
  });

  return grants.map(g => g.permission);
}

/**
 * Concede una permission esplicita a un utente
 * Registra l'azione in PermissionAudit
 *
 * @param prisma - Client Prisma
 * @param userId - ID utente ricevente
 * @param grantedByUserId - ID admin che concede
 * @param permission - Permission da concedere
 * @param reason - Motivo della concessione
 * @param expiresAt - Data di scadenza (opzionale)
 */
export async function grantPermission(
  prisma: PrismaClient,
  {
    userId,
    grantedByUserId,
    permission,
    reason,
    expiresAt,
  }: {
    userId: string;
    grantedByUserId: string;
    permission: Permission;
    reason?: string;
    expiresAt?: Date;
  }
): Promise<void> {
  await prisma.$transaction([
    // Create or update the grant
    prisma.userGrantedPermission.upsert({
      where: {
        userId_permission: {
          userId,
          permission,
        },
      },
      create: {
        userId,
        permission,
        grantedBy: grantedByUserId,
        reason,
        expiresAt,
      },
      update: {
        grantedBy: grantedByUserId,
        reason,
        expiresAt,
      },
    }),

    // Audit the grant
    prisma.permissionAudit.create({
      data: {
        action: 'GRANT',
        actorId: grantedByUserId,
        userId,
        permission,
        reason: reason || `Granted ${permission}`,
      },
    }),
  ]);
}

/**
 * Revoca una permission concessa esplicitamente
 * Registra l'azione in PermissionAudit
 *
 * @param prisma - Client Prisma
 * @param userId - ID utente
 * @param revokedByUserId - ID admin che revoca
 * @param permission - Permission da revocare
 * @param reason - Motivo della revoca
 */
export async function revokePermission(
  prisma: PrismaClient,
  {
    userId,
    revokedByUserId,
    permission,
    reason,
  }: {
    userId: string;
    revokedByUserId: string;
    permission: Permission;
    reason?: string;
  }
): Promise<void> {
  await prisma.$transaction([
    // Delete the grant
    prisma.userGrantedPermission.delete({
      where: {
        userId_permission: {
          userId,
          permission,
        },
      },
    }),

    // Audit the revocation
    prisma.permissionAudit.create({
      data: {
        action: 'REVOKE',
        actorId: revokedByUserId,
        userId,
        permission,
        reason: reason || `Revoked ${permission}`,
      },
    }),
  ]);
}

/**
 * Registra un cambio di ruolo in PermissionAudit
 *
 * @param prisma - Client Prisma
 * @param userId - ID utente
 * @param changedByUserId - ID admin che ha fatto il cambio
 * @param oldRole - Ruolo precedente
 * @param newRole - Nuovo ruolo
 * @param reason - Motivo del cambio
 */
export async function auditRoleChange(
  prisma: PrismaClient,
  {
    userId,
    changedByUserId,
    oldRole,
    newRole,
    reason,
  }: {
    userId: string;
    changedByUserId: string;
    oldRole: Role;
    newRole: Role;
    reason?: string;
  }
): Promise<void> {
  await prisma.permissionAudit.create({
    data: {
      action: 'ROLE_CHANGE',
      actorId: changedByUserId,
      userId,
      oldRole,
      newRole,
      reason: reason || `Role changed from ${oldRole} to ${newRole}`,
    },
  });
}

/**
 * Recupera l'audit trail per un utente
 *
 * @param prisma - Client Prisma
 * @param userId - ID utente
 * @param limit - Numero di record da recuperare (default 100)
 * @returns Array di audit entries
 */
export async function getUserPermissionAudit(
  prisma: PrismaClient,
  userId: string,
  limit: number = 100
) {
  return prisma.permissionAudit.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      action: true,
      permission: true,
      oldRole: true,
      newRole: true,
      reason: true,
      createdAt: true,
      actor: {
        select: {
          id: true,
          email: true,
        },
      },
    },
  });
}

/**
 * Pulisce i grants scaduti
 *
 * @param prisma - Client Prisma
 * @returns Numero di record eliminati
 */
export async function cleanupExpiredGrants(
  prisma: PrismaClient
): Promise<number> {
  const result = await prisma.userGrantedPermission.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(),
      },
    },
  });

  return result.count;
}

// ============================================================================
// RESOURCE PERMISSION GRID
// ============================================================================

/**
 * Definizione delle sezioni con le loro permissions di lettura e scrittura
 */
export const RESOURCE_SECTIONS = [
  {
    resource: 'brands' as const,
    label: 'Brand',
    readPerms: ['brands:read'] as string[],
    writePerms: ['brands:create', 'brands:update', 'brands:delete'] as string[],
  },
  {
    resource: 'users' as const,
    label: 'Utenti',
    readPerms: ['users:read'] as string[],
    writePerms: ['users:create', 'users:update', 'users:delete'] as string[],
  },
  {
    resource: 'config' as const,
    label: 'Configurazione',
    readPerms: ['config:read'] as string[],
    writePerms: ['config:update'] as string[],
  },
  {
    resource: 'settings' as const,
    label: 'Impostazioni',
    readPerms: ['settings:read'] as string[],
    writePerms: ['settings:update'] as string[],
  },
  {
    resource: 'maintenance' as const,
    label: 'Manutenzione',
    readPerms: ['maintenance:read'] as string[],
    writePerms: ['maintenance:update'] as string[],
  },
  {
    resource: 'dashboard' as const,
    label: 'Dashboard',
    readPerms: ['dashboard:read'] as string[],
    writePerms: [] as string[],
  },
] as const;

export type ResourceKey = typeof RESOURCE_SECTIONS[number]['resource'];

export interface SectionPermissionState {
  resource: ResourceKey;
  label: string;
  roleRead: boolean;
  roleWrite: boolean;
  grantRead: boolean;
  grantWrite: boolean;
  effectiveRead: boolean;
  effectiveWrite: boolean;
  hasWrite: boolean;
}

/**
 * Costruisce la griglia di permessi per un utente
 */
export function buildPermissionGrid(
  role: Role,
  grants: string[]
): SectionPermissionState[] {
  return RESOURCE_SECTIONS.map(section => {
    const roleRead = section.readPerms.length > 0
      ? hasPermission({ role }, section.readPerms[0] as Permission)
      : false;
    const roleWrite = section.writePerms.length > 0
      ? section.writePerms.every((p: string) => hasPermission({ role }, p as Permission))
      : false;

    const grantRead = section.readPerms.some((p: string) => grants.includes(p));
    const grantWrite = section.writePerms.length > 0
      ? section.writePerms.every((p: string) => grants.includes(p))
      : false;

    return {
      resource: section.resource,
      label: section.label,
      roleRead,
      roleWrite,
      grantRead,
      grantWrite,
      effectiveRead: roleRead || grantRead,
      effectiveWrite: roleWrite || grantWrite,
      hasWrite: section.writePerms.length > 0,
    };
  });
}

/**
 * Imposta i permessi per una risorsa specifica di un utente
 * level 'none' = rimuove grant espliciti
 * level 'read' = grant solo lettura
 * level 'write' = grant lettura + scrittura
 */
export async function setResourceAccess(
  prisma: PrismaClient,
  actorId: string,
  userId: string,
  resource: ResourceKey,
  level: 'none' | 'read' | 'write'
): Promise<void> {
  const section = RESOURCE_SECTIONS.find(s => s.resource === resource);
  if (!section) return;

  const allPerms = [...section.readPerms, ...section.writePerms];

  if (level === 'none') {
    // Remove ALL explicit grants for this resource
    await prisma.userGrantedPermission.deleteMany({
      where: { userId, permission: { in: allPerms } },
    });
  } else if (level === 'read') {
    // Add read grants
    for (const perm of section.readPerms) {
      await prisma.userGrantedPermission.upsert({
        where: { userId_permission: { userId, permission: perm } },
        create: { userId, permission: perm, grantedBy: actorId },
        update: {},
      });
    }
    // Remove write grants
    if (section.writePerms.length > 0) {
      await prisma.userGrantedPermission.deleteMany({
        where: { userId, permission: { in: [...section.writePerms] } },
      });
    }
  } else if (level === 'write') {
    // Add read AND write grants
    for (const perm of allPerms) {
      await prisma.userGrantedPermission.upsert({
        where: { userId_permission: { userId, permission: perm } },
        create: { userId, permission: perm, grantedBy: actorId },
        update: {},
      });
    }
  }
}
