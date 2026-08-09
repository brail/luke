/**
 * Server-side RBAC configuration management
 * Shared between API and Web for zero-latency access
 */

import { z } from 'zod';

import { SECTION_ACCESS_DEFAULTS } from '../schemas/rbac';

import type { IPrismaConfigClient } from '../runtime/env';

/**
 * Static base of section defaults, in the vocabulary that
 * `effectiveSectionAccess` expects at the 2nd level.
 *
 * Exists because that level read **only** AppConfig, and
 * `rbac.sectionAccessDefaults` is never seeded: absent the key, every
 * section resolved to `'auto'` and fell back to permissions, so
 * `SECTION_ACCESS_DEFAULTS` — described in CLAUDE.md as version-controlled source of truth
 * — did not participate in evaluation. Measured 32 divergences
 * between the table and actual behavior: a viewer saw `settings.ldap`,
 * `admin.brands`, `sales` and other sections that the table denied.
 *
 * Now the table is the **base** and AppConfig the **override**, which is exactly
 * how CLAUDE.md describes the system.
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
const TTL = 60_000; // 60 seconds

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

  // Read both keys in parallel
  const [sectionDefaultsRow, disabledRow] = await Promise.all([
    prisma.appConfig.findUnique({ where: { key: 'rbac.sectionAccessDefaults' } }),
    prisma.appConfig.findUnique({ where: { key: 'app.sections.disabled' } }),
  ]);

  // Static base, overridden per-role by what is in AppConfig. The merge is
  // per-role not per-section: `setRoleDefaults` always writes the full map
  // (`z.record(sectionEnum, …)` is exhaustive), so a role present
  // in AppConfig is already exhaustive by itself.
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
      // Malformed row: fall back to static base, **not** to `{}`.
      // Degrading to empty map here would open every section to every
      // role that had the corresponding permission — a visibility check
      // that fails in opening instead of closing.
    }
  }

  let disabledSections: string[] = [];
  if (disabledRow) {
    try {
      disabledSections = z.array(z.string()).parse(JSON.parse(disabledRow.value));
    } catch {
      // parsing error — use empty default
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
