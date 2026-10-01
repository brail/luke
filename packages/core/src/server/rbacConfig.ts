/**
 * Server-side RBAC configuration: the per-role section defaults and the kill switch AppConfig
 * holds, read with a short cache. Only the API reads it.
 */

import { Roles, type Role } from '../rbac.js';
import { AppConfigRegistry } from '../schemas/config.js';
import {
  SECTION_ACCESS_DEFAULTS,
  sectionDefaultSchema,
  sectionEnum,
  type Section,
  type SectionAccessDefaults,
  type SectionDefault,
} from '../schemas/rbac.js';

import type { IPrismaConfigClient } from '../runtime/env.js';

/** Every role's default for every section, as `effectiveSectionAccess` reads it at layer 2. */
export type ResolvedSectionAccessDefaults = Record<Role, Record<Section, SectionDefault>>;

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
const STATIC_SECTION_DEFAULTS = Object.fromEntries(
  Roles.map(role => [
    role,
    Object.fromEntries(
      sectionEnum.options.map(section => [
        section,
        SECTION_ACCESS_DEFAULTS[role][section] ? 'enabled' : 'disabled',
      ])
    ),
  ])
  // `Object.fromEntries` loses the key types; both maps are built from the exhaustive lists.
) as ResolvedSectionAccessDefaults;

/**
 * The stored defaults over the static table, **per section**: an entry the stored map omits keeps
 * its static value, never `'auto'`. The permission fallback is therefore reached only by an
 * explicit `'auto'`, and a section added to `sectionEnum` later takes its static value on a
 * deployment that stores a map (ADR-027). Used by the reader and by the `setRoleDefaults` guard,
 * which must count against the map the reader will produce.
 */
export function mergeSectionAccessDefaults(
  stored: SectionAccessDefaults
): ResolvedSectionAccessDefaults {
  return Object.fromEntries(
    Roles.map(role => [role, { ...STATIC_SECTION_DEFAULTS[role], ...stored[role] }])
    // `Object.fromEntries` loses the key types; every role of `Roles` is present.
  ) as ResolvedSectionAccessDefaults;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a stored `rbac.sectionAccessDefaults` value entry by entry. Roles and sections the code no
 * longer knows are dropped (a section removed from the enum must not cost the rest of the row).
 * An entry with an invalid value, a role whose value is not an object, and a row that is not a JSON
 * object are ignored and named in `ignored`, so they take the static value.
 *
 * This is an availability policy, not a fail-closed one: an ignored entry takes the static value,
 * which can grant what an intended but corrupt denial would have refused. Failing closed was
 * rejected — `'disabled'` on a corrupt admin entry can lock every administrator out of user
 * administration, and throwing fails every guarded request, including the ones that repair the
 * row. Per entry rather than per row, so one bad value does not discard the row's valid denials.
 */
function readStoredSectionDefaults(raw: string): {
  stored: SectionAccessDefaults;
  ignored: string[];
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { stored: {}, ignored: ['row'] };
  }
  if (!isObject(parsed)) return { stored: {}, ignored: ['row'] };

  const stored: SectionAccessDefaults = {};
  const ignored: string[] = [];
  for (const role of Roles) {
    if (!Object.hasOwn(parsed, role)) continue;
    const sections = parsed[role];
    if (!isObject(sections)) {
      ignored.push(role);
      continue;
    }
    const entries: Partial<Record<Section, SectionDefault>> = {};
    for (const section of sectionEnum.options) {
      if (!Object.hasOwn(sections, section)) continue;
      const value = sectionDefaultSchema.safeParse(sections[section]);
      if (value.success) {
        entries[section] = value.data;
      } else {
        ignored.push(`${role}.${section}`);
      }
    }
    stored[role] = entries;
  }
  return { stored, ignored };
}

/**
 * Receives the entries of a stored RBAC row that the reader ignored: the AppConfig key, and the
 * entries by name (`viewer.admin.brands`, `viewer`, `row`), never their values.
 */
export type RbacConfigWarningHandler = (key: string, ignored: readonly string[]) => void;

let warningHandler: RbacConfigWarningHandler | undefined;

/**
 * Registers, for this process, where `getRbacConfig` reports the entries it ignored: `@luke/core`
 * has no logger, so the API registers its own at startup. Without a handler (unit tests, scripts)
 * nothing is reported. Called on every read that ignores something — every cache rebuild,
 * `bypassCache` read and read after an invalidation — so no frequency is promised.
 */
export function setRbacConfigWarningHandler(handler: RbacConfigWarningHandler | undefined): void {
  warningHandler = handler;
}

function reportIgnored(key: string, ignored: readonly string[]): void {
  if (ignored.length === 0 || !warningHandler) return;
  try {
    warningHandler(key, ignored);
  } catch {
    // Reporting never turns the fallback into a failed request.
  }
}

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
  sectionAccessDefaults: ResolvedSectionAccessDefaults;
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

  let stored: SectionAccessDefaults = {};
  if (sectionDefaultsRow) {
    const read = readStoredSectionDefaults(sectionDefaultsRow.value);
    stored = read.stored;
    reportIgnored('rbac.sectionAccessDefaults', read.ignored);
  }

  // An unreadable kill switch disables nothing: the alternative, everything disabled, would lock
  // every administrator out of the only place where it can be corrected.
  let disabledSections: string[] = [];
  if (disabledRow) {
    const parsed = AppConfigRegistry['app.sections.disabled'].safeParse(disabledRow.value);
    if (parsed.success) {
      disabledSections = parsed.data;
    } else {
      reportIgnored('app.sections.disabled', ['row']);
    }
  }

  const rbacConfig: RbacConfig = {
    sectionAccessDefaults: mergeSectionAccessDefaults(stored),
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
 * `countRecoveryCapableAdmins` before calling it, and invalidates the
 * cache itself after the transaction commits. There is no safe
 * non-transactional variant: an unguarded convenience wrapper existed here
 * before and, being unused, was one accidental call away from silently
 * reintroducing a full admin lockout of Settings.
 */
export async function setRbacSectionDefaultsTx(
  prisma: IPrismaConfigClientWithWrite,
  sectionAccessDefaults: SectionAccessDefaults
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
