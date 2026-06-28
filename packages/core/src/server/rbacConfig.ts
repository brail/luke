/**
 * Server-side RBAC configuration management
 * Shared between API and Web for zero-latency access
 */

import { z } from 'zod';
import type { IPrismaConfigClient } from '../runtime/env';

// Extend interface for write operations if needed
export interface IPrismaConfigClientWithWrite extends IPrismaConfigClient {
  appConfig: IPrismaConfigClient['appConfig'] & {
    upsert(args: any): Promise<any>;
  };
}

interface RbacConfig {
  roleToPermissions: Record<string, string[]>;
  sectionAccessDefaults: Record<string, Record<string, string>>;
  disabledSections: string[];
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
export async function getRbacConfig(
  prisma: IPrismaConfigClient
): Promise<RbacConfig> {
  const cached = cache.get('rbac');
  if (cached && Date.now() - cached.ts < TTL) {
    return cached.data;
  }

  // Leggi entrambe le chiavi in parallelo
  const [sectionDefaultsRow, disabledRow] = await Promise.all([
    prisma.appConfig.findUnique({ where: { key: 'rbac.sectionAccessDefaults' } }),
    prisma.appConfig.findUnique({ where: { key: 'app.sections.disabled' } }),
  ]);

  let sectionAccessDefaults: Record<string, Record<string, string>> = {};
  if (sectionDefaultsRow) {
    try {
      sectionAccessDefaults = JSON.parse(sectionDefaultsRow.value);
    } catch {
      // parsing error — usa default vuoto
    }
  }

  let disabledSections: string[] = [];
  if (disabledRow) {
    try {
      disabledSections = z.array(z.string()).parse(JSON.parse(disabledRow.value));
    } catch {
      // parsing error — usa default vuoto
    }
  }

  const rbacConfig: RbacConfig = {
    roleToPermissions: {
      admin: ['*'],
      editor: ['read', 'update'],
      viewer: ['read'],
    },
    sectionAccessDefaults,
    disabledSections,
  };

  cache.set('rbac', { data: rbacConfig, ts: Date.now() });

  return rbacConfig;
}

/**
 * Ottiene le sezioni disabilitate globalmente (con cache via getRbacConfig)
 */
export async function getSectionsDisabled(
  prisma: IPrismaConfigClient
): Promise<string[]> {
  return (await getRbacConfig(prisma)).disabledSections;
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
  await prisma.appConfig.upsert({
    where: { key: 'rbac.sectionAccessDefaults' },
    update: {
      value: JSON.stringify(sectionAccessDefaults),
      isEncrypted: false,
      updatedAt: new Date(),
    },
    create: {
      key: 'rbac.sectionAccessDefaults',
      value: JSON.stringify(sectionAccessDefaults),
      isEncrypted: false,
    },
  });

  invalidateRbacCache();
}
