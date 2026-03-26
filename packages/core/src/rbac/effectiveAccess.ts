import type { Role } from '../rbac';
import { hasPermission, type Permission } from '../auth/permissions';
import { SECTION_TO_PERMISSION, type Section } from '../schemas/rbac';

type SectionDefault = 'auto' | 'enabled' | 'disabled';

/**
 * Parametri per la valutazione dell'accesso effettivo
 */
type EffectiveAccessParams = {
  /** Ruolo dell'utente */
  role: string;
  /** Default di accesso per ruolo e sezione */
  sectionAccessDefaults: Record<
    string,
    Partial<Record<Section, SectionDefault>>
  >;
  /** Override utente specifico */
  userOverride: { enabled?: boolean | null } | null | undefined;
  /** Sezione da valutare */
  section: Section;
  /** Sezioni disabilitate globalmente (kill switch) */
  disabledSections?: string[];
};

/**
 * Valuta l'accesso effettivo a una sezione considerando la precedenza:
 * 0. Kill switch globale (disabled sections)
 * 1. Override utente (disabled > enabled > manca)
 * 2. Default di ruolo (disabled > enabled > auto)
 * 3. RBAC di ruolo (hasPermission via SECTION_TO_PERMISSION)
 *
 * @param params - Parametri per la valutazione
 * @returns true se accesso consentito, false altrimenti
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
