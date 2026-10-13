import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { UserProfileForm } from '../UserProfileForm';

/**
 * Until the i18n cycle every date is written in one locale (ADR-035), so the profile offers no
 * language to pick — but saving the profile must not overwrite the locale already stored, nor a
 * zone the list does not offer (one the browser-zone dialog saved).
 */

const { updateProfileMock } = vi.hoisted(() => ({ updateProfileMock: vi.fn() }));

vi.mock('../../../../../lib/trpc', () => ({
  trpc: {
    me: {
      updateProfile: { useMutation: () => ({ mutateAsync: updateProfileMock }) },
      changeEmail: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));
vi.mock('../../../../../lib/refresh', () => ({ useRefresh: () => ({ timeZone: vi.fn(), me: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => updateProfileMock.mockReset());

const USER = {
  id: 'u1',
  email: 'mario@example.com',
  username: 'mario',
  firstName: 'Mario',
  lastName: 'Rossi',
  locale: 'en-US',
  timezone: 'Europe/Rome',
  provider: 'LOCAL',
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
};

test('the profile has no language field', async () => {
  const screen = await render(<UserProfileForm user={USER} />);

  await expect.element(screen.getByLabelText('Fuso Orario')).toBeInTheDocument();
  await expect.element(screen.getByLabelText('Lingua')).not.toBeInTheDocument();
});

test('saving the profile resubmits the stored locale', async () => {
  const screen = await render(<UserProfileForm user={USER} />);

  await screen.getByLabelText('Nome', { exact: true }).fill('Maria');
  await screen.getByRole('button', { name: 'Salva Modifiche' }).click();

  await vi.waitFor(() => expect(updateProfileMock).toHaveBeenCalledTimes(1));
  expect(updateProfileMock).toHaveBeenCalledWith({ firstName: 'Maria', lastName: 'Rossi', locale: 'en-US', timezone: 'Europe/Rome' });
});

test('a stored zone the list does not offer is shown as it is, and saving keeps it', async () => {
  const screen = await render(<UserProfileForm user={{ ...USER, timezone: 'Pacific/Chatham' }} />);

  await expect.element(screen.getByLabelText('Fuso Orario')).toHaveTextContent('Pacific/Chatham');

  await screen.getByLabelText('Nome', { exact: true }).fill('Maria');
  await screen.getByRole('button', { name: 'Salva Modifiche' }).click();

  await vi.waitFor(() => expect(updateProfileMock).toHaveBeenCalledTimes(1));
  expect(updateProfileMock).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Pacific/Chatham' }));
});
