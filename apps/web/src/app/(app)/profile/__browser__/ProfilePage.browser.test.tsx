import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import ProfilePage from '../page';

/**
 * Signing out of every device ends this session too, so it asks first (#303); it confirms once,
 * as every `ConfirmDialog` does (its own test covers that).
 */

const { revokeAll } = vi.hoisted(() => ({ revokeAll: vi.fn() }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { accessToken: 't', user: { role: 'viewer' } }, status: 'authenticated' }),
}));
vi.mock('../../../../lib/trpc', () => ({
  trpc: {
    me: {
      get: {
        useQuery: () => ({
          data: {
            id: 'u1',
            email: 'mario@example.com',
            username: 'mario',
            firstName: 'Mario',
            lastName: 'Rossi',
            role: 'viewer',
            provider: 'LOCAL',
            isActive: true,
            emailVerifiedAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastLoginAt: null,
            locale: 'it-IT',
            timezone: 'Europe/Rome',
            dailyGreetingEnabled: true,
            canChangePassword: false,
          },
          isLoading: false,
          error: null,
        }),
      },
      revokeAllSessions: { useMutation: () => ({ mutate: revokeAll, isPending: false }) },
    },
    auth: { requestEmailVerification: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
  },
}));
vi.mock('../../../../lib/sessionEnd', () => ({ endSession: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../_components/ChangePasswordCard', () => ({ ChangePasswordCard: () => null }));
vi.mock('../_components/GreetingPreference', () => ({ GreetingPreference: () => null }));
vi.mock('../_components/NotificationPreferences', () => ({ NotificationPreferences: () => null }));
vi.mock('../_components/UserProfileForm', () => ({ UserProfileForm: () => null }));

afterEach(() => revokeAll.mockReset());

test('signing out of every device asks first; Annulla revokes nothing', async () => {
  const screen = await render(<ProfilePage />);

  await screen.getByRole('button', { name: 'Logout da tutti i dispositivi' }).click();
  await expect.element(screen.getByRole('alertdialog')).toBeInTheDocument();
  expect(revokeAll).not.toHaveBeenCalled();

  await screen.getByRole('button', { name: 'Annulla' }).click();
  expect(revokeAll).not.toHaveBeenCalled();

  await screen.getByRole('button', { name: 'Logout da tutti i dispositivi' }).click();
  await screen.getByRole('button', { name: 'Esci da tutti' }).click();
  expect(revokeAll).toHaveBeenCalledTimes(1);
});
