import { describe, expect, it } from 'vitest';

import { getAuditActionLabel } from '../auditLogLabels.js';

/** The access actions (#222) read in Italian on the audit page and export, not as a humanized code. */
describe('audit labels of the access actions', () => {
  it.each([
    ['USER_ACCESS_CHANGED', 'Accesso utente modificato'],
    ['COMPANY_TEAM_CREATED', 'Team creato'],
    ['COMPANY_TEAM_UPDATED', 'Team modificato'],
    ['COMPANY_TEAM_DELETED', 'Team eliminato'],
    ['COMPANY_TEAM_MEMBER_ADDED', 'Membro aggiunto al team'],
    ['COMPANY_TEAM_MEMBER_REMOVED', 'Membro rimosso dal team'],
    ['COMPANY_TEAM_MEMBER_ROLE_UPDATED', 'Ruolo nel team modificato'],
    ['CALENDAR_EVENT_USER_VISIBILITY_GRANTED', 'Evento condiviso con una persona'],
    ['CALENDAR_EVENT_USER_VISIBILITY_REVOKED', 'Condivisione evento con una persona revocata'],
    ['CALENDAR_EVENT_VISIBILITY_CHANGED', 'Visibilità evento modificata'],
    ['ACCESS_SNAPSHOT', 'Fotografia iniziale degli accessi'],
  ])('%s → %s', (action, label) => {
    expect(getAuditActionLabel(action)).toBe(label);
  });
});
