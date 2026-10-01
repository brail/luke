import { hasPermission, type Permission } from '../auth/permissions.js';
import { SECTION_TO_PERMISSION, type Section, type SectionDefault } from '../schemas/rbac.js';

import { ancestorSectionsOf, childSectionsOf } from './sectionHierarchy.js';

import type { Role } from '../rbac.js';

/**
 * Parameters for evaluating effective section access.
 */
type EffectiveAccessParams = {
  /** Role of the user being evaluated */
  role: string;
  /**
   * Per-role section defaults, already resolved by the caller. `getRbacConfig`
   * builds this map from the static `SECTION_ACCESS_DEFAULTS` base with the
   * AppConfig entries merged over it per section; this resolver never reads
   * AppConfig itself. See ADR-027.
   */
  sectionAccessDefaults: Record<
    string,
    Partial<Record<Section, SectionDefault>>
  >;
  /**
   * The user's overrides, section → enabled. For a section with children, the whole map: a parent
   * is derived from its children, so evaluating it reads their overrides (ADR-025). A section
   * without children reads only its own entry.
   */
  userOverrides: ReadonlyMap<string, boolean> | null | undefined;
  /** Section to evaluate */
  section: Section;
  /** Globally disabled sections (kill switch — highest precedence) */
  disabledSections?: string[];
};

/**
 * Resolves whether a user can access a section.
 *
 * A section with children is **derived**: it is accessible if and only if at least one of its
 * children is (ADR-025). Its own override, role default and permission are not consulted, so a
 * parent can never be on with every child off, nor a child on with its parent off.
 *
 * A section without children applies four precedence layers in order (ADR-025):
 * 0. Global kill switch (`disabledSections`), on the section or on any section it is nested under
 * 1. Per-user override (`disabled > enabled > absent`)
 * 2. Per-role default from the supplied map (`disabled > enabled > auto`)
 * 3. Role RBAC fallback via `SECTION_TO_PERMISSION`
 *
 * @returns `true` if access is granted, `false` otherwise
 */
export function effectiveSectionAccess(params: EffectiveAccessParams): boolean {
  const children = childSectionsOf(params.section);
  if (children.length > 0) {
    return children.some(child => effectiveSectionAccess({ ...params, section: child }));
  }
  return leafSectionAccess(params);
}

/**
 * Layer 0, the global kill switch (`app.sections.disabled`): `true` when it lists the section or any
 * section it is nested under. One predicate for the resolver and for the access dialogs, which
 * show such a section as off and locked.
 */
export function isGloballyDisabled(
  section: Section,
  disabledSections: readonly string[] | undefined
): boolean {
  return [section, ...ancestorSectionsOf(section)].some(s => disabledSections?.includes(s));
}

function leafSectionAccess({
  role,
  sectionAccessDefaults,
  userOverrides,
  section,
  disabledSections,
}: EffectiveAccessParams): boolean {
  // 0) Global kill switch - maximum precedence. Disabling a parent disables its whole group.
  if (isGloballyDisabled(section, disabledSections)) return false;

  // 1) User override - high precedence
  const override = userOverrides?.get(section);
  if (override === false) return false;
  if (override === true) return true;

  // 2) Role default from the supplied map (static base + AppConfig override)
  const roleDefaults = sectionAccessDefaults[role] || {};
  const defaultForSection = roleDefaults[section] ?? 'auto';

  if (defaultForSection === 'disabled') return false;
  if (defaultForSection === 'enabled') return true;

  // 3) RBAC role fallback — uses the new Resource:Action system
  const permission = SECTION_TO_PERMISSION[section];
  if (!permission) return false;
  return hasPermission({ role: role as Role }, permission as Permission);
}
