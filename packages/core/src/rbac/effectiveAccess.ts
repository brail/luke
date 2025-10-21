import { canPerform } from '../rbac';
import type { Section, SectionDefault } from '../schemas/rbac';

/**
 * Parametri per la valutazione dell'accesso effettivo
 */
type EffectiveAccessParams = {
  /** Ruolo dell'utente */
  role: string;
  /** Mapping ruoli -> permessi */
  roleToPermissions: Record<string, string[]>;
  /** Default di accesso per ruolo e sezione */
  sectionAccessDefaults: Record<
    string,
    Partial<Record<Section, SectionDefault>>
  >;
  /** Override utente specifico */
  userOverride: { enabled?: boolean | null } | null | undefined;
  /** Sezione da valutare */
  section: Section;
};

/**
 * Valuta l'accesso effettivo a una sezione considerando la precedenza:
 * 1. Override utente (disabled > enabled > manca)
 * 2. Default di ruolo (disabled > enabled > auto)
 * 3. RBAC di ruolo (hasPermission)
 *
 * @param params - Parametri per la valutazione
 * @returns true se accesso consentito, false altrimenti
 */
export function effectiveSectionAccess({
  role,
  roleToPermissions,
  sectionAccessDefaults,
  userOverride,
  section,
}: EffectiveAccessParams): boolean {
  // 1) Override utente - precedenza massima
  if (userOverride?.enabled === false) return false;
  if (userOverride?.enabled === true) return true;

  // 2) Default di ruolo da AppConfig
  const roleDefaults = sectionAccessDefaults[role] || {};
  const defaultForSection = roleDefaults[section] ?? 'auto';

  if (defaultForSection === 'disabled') return false;
  if (defaultForSection === 'enabled') return true;

  // 3) Fallback RBAC ruolo (read)
  return canPerform(role as any, section, 'read');
}
