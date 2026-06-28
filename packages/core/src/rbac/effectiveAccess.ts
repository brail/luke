import type { Role } from '../rbac';
import { hasPermission, type Permission } from '../auth/permissions';
import { SECTION_TO_PERMISSION, type Section } from '../schemas/rbac';

type SectionDefault = 'auto' | 'enabled' | 'disabled';

/**
 * Parameters for evaluating effective section access.
 */
type EffectiveAccessParams = {
  /** Role of the user being evaluated */
  role: string;
  /** Per-role section access defaults loaded from AppConfig */
  sectionAccessDefaults: Record<
    string,
    Partial<Record<Section, SectionDefault>>
  >;
  /** User-specific override, if any */
  userOverride: { enabled?: boolean | null } | null | undefined;
  /** Section to evaluate */
  section: Section;
  /** Globally disabled sections (kill switch — highest precedence) */
  disabledSections?: string[];
};

/**
 * Resolves whether a user can access a section, applying four precedence layers in order:
 * 0. Global kill switch (`disabledSections`)
 * 1. Per-user override (`disabled > enabled > absent`)
 * 2. Per-role AppConfig default (`disabled > enabled > auto`)
 * 3. Role RBAC fallback via `SECTION_TO_PERMISSION`
 *
 * @returns `true` if access is granted, `false` otherwise
 */
export function effectiveSectionAccess({
  role,
  sectionAccessDefaults,
  userOverride,
  section,
  disabledSections,
}: EffectiveAccessParams): boolean {
  // 0) Kill switch globale - precedenza massima
  if (disabledSections?.includes(section)) return false;

  // 1) Override utente - precedenza alta
  if (userOverride?.enabled === false) return false;
  if (userOverride?.enabled === true) return true;

  // 2) Default di ruolo da AppConfig
  const roleDefaults = sectionAccessDefaults[role] || {};
  const defaultForSection = roleDefaults[section] ?? 'auto';

  if (defaultForSection === 'disabled') return false;
  if (defaultForSection === 'enabled') return true;

  // 3) Fallback RBAC ruolo — usa il nuovo sistema Resource:Action
  const permission = SECTION_TO_PERMISSION[section];
  if (!permission) return false;
  return hasPermission({ role: role as Role }, permission as Permission);
}
