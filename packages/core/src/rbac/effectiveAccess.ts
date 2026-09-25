import { hasPermission, type Permission } from '../auth/permissions.js';
import { SECTION_TO_PERMISSION, type Section } from '../schemas/rbac.js';

import { ancestorSectionsOf, childSectionsOf } from './sectionHierarchy.js';

import type { Role } from '../rbac.js';

type SectionDefault = 'auto' | 'enabled' | 'disabled';

/**
 * Parameters for evaluating effective section access.
 */
type EffectiveAccessParams = {
  /** Role of the user being evaluated */
  role: string;
  /**
   * Per-role section defaults, already resolved by the caller. `getRbacConfig`
   * builds this map from the static `SECTION_ACCESS_DEFAULTS` base with any
   * AppConfig per-role override merged over it; this resolver never reads
   * AppConfig itself. See ADR-025.
   */
  sectionAccessDefaults: Record<
    string,
    Partial<Record<Section, SectionDefault>>
  >;
  /**
   * The user's overrides, section → enabled. The whole map, not the one for `section`: a parent
   * section is derived from its children, so evaluating it reads their overrides (ADR-025).
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

function leafSectionAccess({
  role,
  sectionAccessDefaults,
  userOverrides,
  section,
  disabledSections,
}: EffectiveAccessParams): boolean {
  // 0) Global kill switch - maximum precedence. Disabling a parent disables its whole group.
  if (disabledSections?.includes(section)) return false;
  if (ancestorSectionsOf(section).some(ancestor => disabledSections?.includes(ancestor))) {
    return false;
  }

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
