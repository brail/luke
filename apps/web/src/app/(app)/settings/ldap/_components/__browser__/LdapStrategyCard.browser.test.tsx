import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { LdapStrategyCard } from '../LdapStrategyCard';

/** With no valid strategy stored, the card says so and saves only once one is chosen. */

vi.mock('../../../../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock('../../../../../../lib/trpc', () => ({
  trpc: { integrations: { auth: { saveStrategy: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } } } },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

test('nothing stored: placeholder, warning, save disabled', async () => {
  const screen = await render(<LdapStrategyCard stored={null} readAt={1} />);

  await expect.element(screen.getByText('Non impostata')).toBeVisible();
  await expect.element(screen.getByText('Nessuna strategia salvata', { exact: false })).toBeVisible();
  await expect.element(screen.getByRole('button', { name: 'Salva strategia' })).toBeDisabled();
});

test('a stored strategy: no warning', async () => {
  const screen = await render(<LdapStrategyCard stored="local-first" readAt={1} />);

  await expect.element(screen.getByRole('button', { name: 'Salva strategia' })).toBeInTheDocument();
  expect(screen.getByText('Nessuna strategia salvata', { exact: false }).elements()).toHaveLength(0);
});
