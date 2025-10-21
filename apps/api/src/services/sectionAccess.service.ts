/**
 * Service layer per gestione override di accesso alle sezioni
 * Gestisce CRUD e safety checks per UserSectionAccess
 */

import type { PrismaClient } from '@prisma/client';
import type { Section } from '@luke/core';

/**
 * Ottiene l'override per un utente e sezione specifica
 */
export async function getOverride(
  prisma: PrismaClient,
  userId: string,
  section: Section
) {
  return prisma.userSectionAccess.findFirst({
    where: {
      userId,
      section,
    },
  });
}

/**
 * Imposta o rimuove l'override per un utente e sezione
 * @param enabled - true=allow, false=deny, null=rimuovi override
 */
export async function setOverride(
  prisma: PrismaClient,
  userId: string,
  section: Section,
  enabled: boolean | null
) {
  if (enabled === null) {
    // Rimuovi override
    await prisma.userSectionAccess
      .deleteMany({
        where: {
          userId,
          section,
        },
      })
      .catch(() => {}); // Ignora errore se record non esiste
    return null;
  }

  // Upsert override - prima elimina se esiste, poi crea
  await prisma.userSectionAccess.deleteMany({
    where: {
      userId,
      section,
    },
  });

  return prisma.userSectionAccess.create({
    data: {
      userId,
      section,
      enabled,
    },
  });
}

/**
 * Lista tutti gli override per un utente
 */
export async function listOverridesForUser(
  prisma: PrismaClient,
  userId: string
) {
  return prisma.userSectionAccess.findMany({
    where: { userId },
  });
}

/**
 * Conta quanti admin hanno accesso ai settings
 * Usato per last-admin safety check
 */
export async function countAdminsWithSettingsAccess(
  prisma: PrismaClient
): Promise<number> {
  // Conta admin che:
  // 1. Hanno ruolo admin E
  // 2. NON hanno override disabled su 'settings'
  const adminCount = await prisma.user.count({
    where: {
      role: 'admin',
      isActive: true,
      OR: [
        // Nessun override (usa ruolo)
        {
          sectionAccess: {
            none: {
              section: 'settings',
            },
          },
        },
        // Override enabled
        {
          sectionAccess: {
            some: {
              section: 'settings',
              enabled: true,
            },
          },
        },
      ],
    },
  });

  return adminCount;
}
