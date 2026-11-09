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
  ])('%s → %s', (action, label) => {
    expect(getAuditActionLabel(action)).toBe(label);
  });
});
