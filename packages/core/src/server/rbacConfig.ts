/**
 * Server-side RBAC configuration management
 * Shared between API and Web for zero-latency access
 */

import { z } from 'zod';

import { SECTION_ACCESS_DEFAULTS } from '../schemas/rbac';

import type { IPrismaConfigClient } from '../runtime/env';

/**
 * Base statica dei default di sezione, nel vocabolario che
 * `effectiveSectionAccess` si aspetta al 2° livello.
 *
 * Esiste perché quel livello leggeva **solo** AppConfig, e
 * `rbac.sectionAccessDefaults` non è mai seedata: assente la chiave, ogni
 * sezione risolveva `'auto'` e decideva il fallback sui permessi, quindi
 * `SECTION_ACCESS_DEFAULTS` — descritta in CLAUDE.md come fonte di verità
 * version-controlled — non partecipava alla valutazione. Misurate 32 divergenze
 * fra la tabella e il comportamento reale: un viewer vedeva `settings.ldap`,
 * `admin.brands`, `sales` e altre sezioni che la tabella dà per negate.
 *
 * Ora la tabella è la **base** e AppConfig l'**override**, che è esattamente
 * come CLAUDE.md descrive il sistema.
 */
const STATIC_SECTION_DEFAULTS: Record<string, Record<string, string>> =
  Object.fromEntries(
    Object.entries(SECTION_ACCESS_DEFAULTS).map(([role, sections]) => [
      role,
      Object.fromEntries(
        Object.entries(sections).map(([section, allowed]) => [
          section,
          allowed ? 'enabled' : 'disabled',
        ])
      ),
    ])
  );

// Extend interface for write operations if needed
/** Extends `IPrismaConfigClient` with write capabilities needed for upsert operations. */
export interface IPrismaConfigClientWithWrite extends IPrismaConfigClient {
  appConfig: IPrismaConfigClient['appConfig'] & {
    upsert(args: {
      where: { key: string };
      update: { value: string; isEncrypted?: boolean; updatedAt?: Date };
      create: { key: string; value: string; isEncrypted?: boolean };
    }): Promise<unknown>;
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
 * @param opts.bypassCache - Skip the cache and read fresh from the DB. Required
 *   for last-admin/kill-switch guards evaluated inside a transaction: the
 *   advisory lock they hold serializes concurrent writers but does not force
 *   a cache miss, so a plain cached read can still evaluate the invariant
 *   against a value stale by up to the cache TTL.
 * @returns RBAC configuration including section defaults and disabled sections
 */
export async function getRbacConfig(
  prisma: IPrismaConfigClient,
  opts: { bypassCache?: boolean } = {}
): Promise<RbacConfig> {
  const cached = cache.get('rbac');
  if (!opts.bypassCache && cached && Date.now() - cached.ts < TTL) {
    return cached.data;
  }

  // Leggi entrambe le chiavi in parallelo
  const [sectionDefaultsRow, disabledRow] = await Promise.all([
    prisma.appConfig.findUnique({ where: { key: 'rbac.sectionAccessDefaults' } }),
    prisma.appConfig.findUnique({ where: { key: 'app.sections.disabled' } }),
  ]);

  // Base statica, sovrascritta per ruolo da quanto c'è in AppConfig. Il merge è
  // per ruolo e non per sezione: `setRoleDefaults` scrive sempre la mappa
  // completa (`z.record(sectionEnum, …)` è esaustivo), quindi un ruolo presente
  // in AppConfig è già esaustivo di suo.
  let sectionAccessDefaults: Record<string, Record<string, string>> = {
    ...STATIC_SECTION_DEFAULTS,
  };

  if (sectionDefaultsRow) {
    try {
      const stored = JSON.parse(sectionDefaultsRow.value) as Record<
        string,
        Record<string, string>
      >;
      sectionAccessDefaults = { ...sectionAccessDefaults, ...stored };
    } catch {
      // Riga malformata: si resta sulla base statica, **non** su `{}`.
      // Degradare a mappa vuota qui significava aprire ogni sezione a ogni
      // ruolo che avesse il permesso corrispondente — un controllo di
      // visibilità che fallisce in apertura invece che in chiusura.
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
 * Persists per-role section-access defaults to AppConfig. Write-only —
 * deliberately does NOT invalidate the cache or check any invariant. The
 * only legitimate caller is `sectionAccessRouter.setRoleDefaults`, which
 * wraps this in its own `$transaction` with `acquireLastAdminLock` +
 * `countAdminsWithSettingsAccess` before calling it, and invalidates the
 * cache itself after the transaction commits. There is no safe
 * non-transactional variant: an unguarded convenience wrapper existed here
 * before and, being unused, was one accidental call away from silently
 * reintroducing a full admin lockout of Settings.
 */
export async function setRbacSectionDefaultsTx(
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
}
