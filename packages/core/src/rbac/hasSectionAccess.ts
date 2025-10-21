/**
 * Logica di valutazione accesso per sezioni con override utente
 * Implementa la precedenza: deny > allow > role
 */

import { canPerform } from '../rbac';
import type { Section } from './sections';

export type SectionOverride = 'enabled' | 'disabled' | 'auto'; // auto = nessun override

export interface SectionAccessRecord {
  section: Section;
  override: SectionOverride; // lato DB memorizziamo booleano; qui esponiamo il tri-state
}

/**
 * Valuta l'accesso effettivo a una sezione considerando override utente e ruolo
 *
 * @param params - Parametri per la valutazione
 * @param params.role - Ruolo dell'utente (admin/editor/viewer)
 * @param params.rolePermissions - Mappa permessi per ruolo
 * @param params.override - Override utente (opzionale)
 * @param params.section - Sezione da valutare
 * @returns true se accesso consentito, false altrimenti
 */
export function effectiveSectionAccess(params: {
  role: string; // ruolo dell'utente (admin/editor/viewer)
  rolePermissions: Record<string, string[]>; // mappa ruolo->permessi
  override?: { enabled?: boolean | null }; // null/undefined = auto
  section: Section;
}): boolean {
  const { role, rolePermissions, override, section } = params;

  // Precedenza: deny > allow > role
  if (override?.enabled === false) return false;
  if (override?.enabled === true) return true;

  // fallback: RBAC di ruolo (read/view)
  return canPerform(role as any, section, 'read');
}
