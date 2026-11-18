import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import CompanySettingsPage from '../page';

/** The organization tab reads the teams: it shows only to whoever may read them. */

const h = vi.hoisted((): { held: Set<string> } => ({ held: new Set() }));

vi.mock('../../../../../hooks/usePermission', () => ({
  usePermission: () => ({ can: (permission: string) => h.held.has(permission) }),
}));
vi.mock('../_components/ProfileTab', () => ({ ProfileTab: () => <p>profilo</p> }));
vi.mock('../_components/BusinessTimeZoneCard', () => ({ BusinessTimeZoneCard: () => null }));
vi.mock('../_components/OrganizationTab', () => ({ OrganizationTab: () => <p>organizzazione</p> }));

test.each([
  ['without', [], 0],
  ['with', ['company_team:read'], 1],
] as const)('the organization tab, %s the team read', async (_name, held, shown) => {
  h.held = new Set(held);
  const screen = await render(<CompanySettingsPage />);
  await expect.element(screen.getByRole('tab', { name: 'Profilo' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Organizzazione' }).elements()).toHaveLength(shown);
});
