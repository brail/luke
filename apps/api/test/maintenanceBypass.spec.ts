/**
 * Who keeps working through maintenance mode. The bypass follows the permission that manages the
 * mode (`maintenance:update`, the one `adminProcedure` checks), not the role name, and a role
 * outside `Roles` holds nothing, so it stays blocked.
 */

import { describe, expect, it } from 'vitest';

import { bypassesMaintenance } from '../src/lib/maintenanceMode';

describe('bypassesMaintenance', () => {
  it('lets through whoever can manage maintenance', () => {
    expect(bypassesMaintenance('admin')).toBe(true);
  });

  it.each(['editor', 'viewer'])('blocks %s, which cannot manage it', role => {
    expect(bypassesMaintenance(role)).toBe(false);
  });

  it('blocks a role outside Roles instead of guessing', () => {
    expect(bypassesMaintenance('superuser')).toBe(false);
  });
});
