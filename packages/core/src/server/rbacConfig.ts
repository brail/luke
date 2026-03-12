/**
 * Server-side RBAC configuration management
 * Shared between API and Web for zero-latency access
 */

import { z } from 'zod';
import { rbacConfigSchema, type RbacConfig } from '../schemas/rbac';
import type { IPrismaConfigClient } from '../runtime/env';

// Extend interface for write operations if needed
export interface IPrismaConfigClientWithWrite extends IPrismaConfigClient {
  appConfig: IPrismaConfigClient['appConfig'] & {
    upsert(args: any): Promise<any>;
  }
}

/**
 * Cache in-memory per configurazioni RBAC
 */
const cache = new Map<string, { data: RbacConfig; ts: number }>();
const TTL = 60_000; // 60 secondi

/**
 * Invalida la cache RBAC
 */
export function invalidateRbacCache(): void {
  cache.clear();
}

/**
 * Ottiene la configurazione RBAC da AppConfig con cache
 * @param prisma - Client Prisma
 * @returns Configurazione RBAC completa
 */
export async function getRbacConfig(prisma: IPrismaConfigClient): Promise<RbacConfig> {
  const cached = cache.get('rbac');
  if (cached && Date.now() - cached.ts < TTL) {
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
  cache.set('rbac', { data: rbacConfig, ts: Date.now() });

  return rbacConfig;
}

/**
 * Salva i default di accesso alle sezioni per ruolo
 * @param prisma - Client Prisma
 * @param sectionAccessDefaults - Default per ruolo e sezione
 */
export async function setRbacSectionDefaults(
  prisma: IPrismaConfigClientWithWrite,
  sectionAccessDefaults: Record<string, Partial<Record<string, string>>>
): Promise<void> {
  // Valida con schema Zod
  const validated = rbacConfigSchema.parse({
    roleToPermissions: {
      admin: ['*'],
      editor: ['read', 'update'],
      viewer: ['read'],
    },
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

/**
 * Ottiene le sezioni disabilitate globalmente
 * @param prisma - Client Prisma
 * @returns Array di sezioni disabilitate
 */
export async function getSectionsDisabled(prisma: IPrismaConfigClient): Promise<string[]> {
  const config = await prisma.appConfig.findUnique({
    where: { key: 'app.sections.disabled' },
  });

  if (!config) return [];

  try {
    const parsed = JSON.parse(config.value);
    return z.array(z.string()).parse(parsed);
  } catch (error) {
    console.warn(
      'Errore parsing app.sections.disabled, usando array vuoto:',
      error
    );
    return [];
  }
}
