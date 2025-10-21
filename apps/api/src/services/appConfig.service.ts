/**
 * Service layer per gestione configurazioni AppConfig con cache
 * Gestisce lettura/scrittura configurazioni RBAC con cache in-memory
 */

import type { PrismaClient } from '@prisma/client';
import { rbacConfigSchema, type RbacConfig } from '@luke/core';

/**
 * Cache in-memory per configurazioni RBAC
 */
const rbacCache = new Map<string, { data: RbacConfig; timestamp: number }>();
const CACHE_TTL = 60 * 1000; // 60 secondi

/**
 * Invalida la cache RBAC
 */
export function invalidateRbacCache(): void {
  rbacCache.clear();
}

/**
 * Ottiene la configurazione RBAC da AppConfig con cache
 * @param prisma - Client Prisma
 * @returns Configurazione RBAC completa
 */
export async function getRbacConfig(prisma: PrismaClient): Promise<RbacConfig> {
  const cacheKey = 'rbac';
  const now = Date.now();

  // Controlla cache
  const cached = rbacCache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  // Leggi da AppConfig
  const config = await prisma.appConfig.findUnique({
    where: { key: 'rbac.sectionAccessDefaults' },
  });

  let sectionAccessDefaults = {};

  if (config) {
    try {
      sectionAccessDefaults = JSON.parse(config.value);
    } catch (error) {
      console.warn(
        'Errore parsing rbac.sectionAccessDefaults, usando default vuoto:',
        error
      );
    }
  }

  // Costruisci configurazione completa
  const rbacConfig: RbacConfig = {
    roleToPermissions: {
      admin: ['*'],
      editor: ['read', 'update'],
      viewer: ['read'],
    },
    sectionAccessDefaults,
  };

  // Aggiorna cache
  rbacCache.set(cacheKey, { data: rbacConfig, timestamp: now });

  return rbacConfig;
}

/**
 * Salva i default di accesso alle sezioni per ruolo
 * @param prisma - Client Prisma
 * @param sectionAccessDefaults - Default per ruolo e sezione
 */
export async function setRbacSectionDefaults(
  prisma: PrismaClient,
  sectionAccessDefaults: Record<string, Partial<Record<string, string>>>
): Promise<void> {
  // Valida con schema Zod
  const validated = rbacConfigSchema.parse({
    roleToPermissions: {},
    sectionAccessDefaults,
  });

  // Salva in AppConfig
  await prisma.appConfig.upsert({
    where: { key: 'rbac.sectionAccessDefaults' },
    update: {
      value: JSON.stringify(validated.sectionAccessDefaults),
      isEncrypted: false,
      updatedAt: new Date(),
    },
    create: {
      key: 'rbac.sectionAccessDefaults',
      value: JSON.stringify(validated.sectionAccessDefaults),
      isEncrypted: false,
    },
  });

  // Invalida cache
  invalidateRbacCache();
}
