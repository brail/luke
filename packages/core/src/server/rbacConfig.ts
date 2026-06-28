/**
 * Server-side RBAC configuration management
 * Shared between API and Web for zero-latency access
 */

import { z } from 'zod';
import type { IPrismaConfigClient } from '../runtime/env';

// Extend interface for write operations if needed
/** Extends `IPrismaConfigClient` with write capabilities needed for upsert operations. */
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

/** In-memory TTL cache for RBAC configuration. Invalidated by `invalidateRbacCache()`. */
const cache = new Map<string, { data: RbacConfig; ts: number }>();
const TTL = 60_000; // 60 secondi

/**
 * Clears the in-memory RBAC cache, forcing the next call to `getRbacConfig` to re-read from the database.
 * Must be called after any write to RBAC-related AppConfig keys.
 */
export function invalidateRbacCache(): void {
  cache.clear();
}

/**
 * Retrieves the full RBAC configuration from AppConfig, using a 60-second in-memory cache.
 *
 * @param prisma - Prisma client instance
 * @returns RBAC configuration including section defaults and disabled sections
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
 * Returns the list of globally disabled sections (kill-switch), loaded via the cached `getRbacConfig`.
 */
export async function getSectionsDisabled(
  prisma: IPrismaConfigClient
): Promise<string[]> {
  return (await getRbacConfig(prisma)).disabledSections;
}

/**
 * Persists per-role section-access defaults to AppConfig and invalidates the RBAC cache.
 *
 * @param prisma - Prisma client with write capabilities
 * @param sectionAccessDefaults - Map of role → section → `'enabled' | 'disabled' | 'auto'`
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
