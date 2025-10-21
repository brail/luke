/**
 * Service layer per logica RBAC e safety checks
 * Gestisce verifiche di sicurezza per modifiche configurazioni RBAC
 */

import type { PrismaClient } from '@prisma/client';
import { effectiveSectionAccess } from '@luke/core';
import { permissions } from '@luke/core';
import { getOverride } from './sectionAccess.service';

/**
 * Verifica se impostare i nuovi default bloccherebbe tutti gli admin dall'accesso ai settings
 * @param prisma - Client Prisma
 * @param sectionAccessDefaults - Nuovi default da verificare
 * @returns true se bloccherebbe tutti gli admin, false altrimenti
 */
export async function wouldLockAllAdminsFromSettings(
  prisma: PrismaClient,
  sectionAccessDefaults: Record<string, Partial<Record<string, string>>>
): Promise<boolean> {
  // Trova tutti gli admin attivi
  const admins = await prisma.user.findMany({
    where: {
      role: 'admin',
      isActive: true,
    },
    select: {
      id: true,
      role: true,
    },
  });

  if (admins.length === 0) {
    return true; // Nessun admin = blocco totale
  }

  // Per ogni admin, verifica se avrebbe accesso ai settings
  for (const admin of admins) {
    // Recupera override esistenti per questo admin
    const settingsOverride = await getOverride(
      prisma,
      admin.id,
      'settings'
    ).catch(() => null);

    // Simula effectiveSectionAccess con i nuovi default
    const hasAccess = effectiveSectionAccess({
      role: admin.role,
      roleToPermissions:
        permissions[admin.role as keyof typeof permissions] || {},
      sectionAccessDefaults,
      userOverride: settingsOverride
        ? { enabled: settingsOverride.enabled }
        : undefined,
      section: 'settings',
    });

    if (hasAccess) {
      return false; // Almeno un admin ha accesso
    }
  }

  return true; // Nessun admin ha accesso
}
