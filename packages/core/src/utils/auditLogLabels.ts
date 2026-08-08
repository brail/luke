/**
 * Human-readable labels for `AuditLog.action` codes (SCREAMING_SNAKE_CASE) in Italian.
 * Shared between the API's CSV export and the web audit log viewer/widget so both render
 * the exact same wording. Deliberately not exhaustive — grows incrementally as new areas
 * are covered; `getAuditActionLabel` falls back to a humanized version of the raw code.
 */

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  // Collection layout
  COLLECTION_ROW_CREATE: 'Riga collezione creata',
  COLLECTION_ROW_UPDATE: 'Riga collezione modificata',
  COLLECTION_ROW_DELETE: 'Riga collezione eliminata',
  COLLECTION_ROW_DUPLICATE: 'Riga collezione duplicata',
  COLLECTION_ROW_REORDER: 'Righe collezione riordinate',
  COLLECTION_ROW_COMPLETE: 'Riga collezione conclusa',
  COLLECTION_ROW_REOPEN: 'Riga collezione riaperta',
  COLLECTION_GROUP_CREATE: 'Gruppo collezione creato',
  COLLECTION_GROUP_UPDATE: 'Gruppo collezione modificato',
  COLLECTION_GROUP_DELETE: 'Gruppo collezione eliminato',
  COLLECTION_QUOTATION_CREATE: 'Preventivo riga creato',
  COLLECTION_QUOTATION_UPDATE: 'Preventivo riga modificato',
  COLLECTION_QUOTATION_DELETE: 'Preventivo riga eliminato',
  COLLECTION_LAYOUT_UPDATE_SETTINGS: 'Impostazioni collection layout modificate',
  COLLECTION_LAYOUT_COPY_FROM_SEASON: 'Collection layout copiato da altra stagione',
  COLLECTION_LAYOUT_REVISION_CREATE: 'Revisione collection layout creata',
  COLLECTION_LAYOUT_REVISION_AUTO_CREATE: 'Revisione collection layout automatica (milestone)',

  // Planning group / calendar
  PLANNING_GROUP_FROZEN: 'Pianificazione congelata',
  PLANNING_GROUP_UNFROZEN: 'Pianificazione scongelata',
  PLANNING_GROUP_FREEZE_AMENDED: 'Congelamento pianificazione aggiornato',
  PLANNING_GROUP_APPLY_TEMPLATE: 'Template milestone applicato alla pianificazione',
  CALENDAR_EVENT_CREATE: 'Evento calendario creato',
  CALENDAR_EVENT_UPDATE: 'Evento calendario modificato',
  CALENDAR_EVENT_RESCHEDULE: 'Evento calendario riprogrammato',
  CALENDAR_EVENT_CANCEL: 'Evento calendario annullato',
  CALENDAR_EVENT_UNCANCEL: 'Annullamento evento calendario ripristinato',
  CALENDAR_MILESTONE_DELETE: 'Milestone calendario eliminata',
  MILESTONE_TEMPLATE_CREATE: 'Template milestone creato',
  MILESTONE_TEMPLATE_UPDATE: 'Template milestone modificato',
  MILESTONE_TEMPLATE_DELETE: 'Template milestone eliminato',

  // Pricing
  PRICING_PARAMETER_SET_CREATE: 'Set parametri pricing creato',
  PRICING_PARAMETER_SET_UPDATE: 'Set parametri pricing modificato',
  PRICING_PARAMETER_SET_DELETE: 'Set parametri pricing eliminato',
  PRICING_PARAMETER_SET_SET_DEFAULT: 'Set parametri pricing impostato come default',

  // Auth / users
  AUTH_LOGIN: 'Accesso effettuato',
  AUTH_LOGIN_FAILED: 'Tentativo di accesso fallito',
  USER_CREATE: 'Utente creato',
  USER_UPDATE: 'Utente modificato',
  USER_DELETE: 'Utente eliminato',
  USER_APPROVED: 'Utente approvato',
  USER_REVOKE_SESSIONS: 'Sessioni utente revocate',
  USER_PASSWORD_RESET_BY_ADMIN: 'Password utente reimpostata da admin',

  // Config / backup / maintenance
  CONFIG_UPSERT: 'Configurazione aggiornata',
  CONFIG_DELETE: 'Configurazione eliminata',
  SECTION_ACCESS_UPDATED: 'Permessi sezione aggiornati',
  BACKUP_CREATE: 'Backup creato',
  BACKUP_DELETE: 'Backup eliminato',
  BACKUP_RESTORE: 'Backup ripristinato',
  BACKUP_EXPORT: 'Backup esportato',
  MAINTENANCE_MODE_ACTIVATED: 'Modalità manutenzione attivata',
};

/** Humanizes an unmapped SCREAMING_SNAKE_CASE action code (e.g. `SOME_NEW_ACTION` → "Some new action"). */
function humanizeActionCode(action: string): string {
  const [first, ...rest] = action.toLowerCase().split('_');
  return `${first.charAt(0).toUpperCase()}${first.slice(1)} ${rest.join(' ')}`.trim();
}

/** Returns the label for an audit action code, falling back to a humanized version if unmapped. */
export function getAuditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? humanizeActionCode(action);
}
