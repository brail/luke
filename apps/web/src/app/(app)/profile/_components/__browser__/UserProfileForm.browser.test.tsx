import { toast } from 'sonner';
import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../components/ui/tooltip';
import { UserProfileForm } from '../UserProfileForm';

/**
 * Until the i18n cycle every date is written in one locale (ADR-035), so the profile offers no
 * language to pick — but saving the profile must not overwrite the locale already stored, nor a
 * zone the list does not offer (one the browser-zone dialog saved).
 */

const { updateProfileMock, changeEmailMock } = vi.hoisted(() => ({ updateProfileMock: vi.fn(), changeEmailMock: vi.fn() }));

vi.mock('../../../../../lib/trpc', () => ({
  trpc: {
    me: {
      updateProfile: { useMutation: () => ({ mutateAsync: updateProfileMock }) },
      changeEmail: { useMutation: () => ({ mutateAsync: changeEmailMock }) },
    },
  },
}));
vi.mock('../../../../../lib/refresh', () => ({ useRefresh: () => ({ timeZone: vi.fn(), me: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  updateProfileMock.mockReset();
  changeEmailMock.mockReset();
  vi.mocked(toast.error).mockClear();
});

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

test('changing the email asks for the current password', async () => {
  // Never settles: the success path reloads the page.
  changeEmailMock.mockReturnValue(new Promise(() => {}));
  const screen = await render(<UserProfileForm user={USER} />);
  const update = screen.getByRole('button', { name: 'Aggiorna' });

  await screen.getByLabelText('Cambia Email').fill('nuova@example.com');
  await expect.element(update).toBeDisabled();

  await screen.getByLabelText('Password attuale').fill('my-password');
  await expect.element(update).toBeEnabled();
  await update.click();

  await vi.waitFor(() => expect(changeEmailMock).toHaveBeenCalledTimes(1));
  expect(changeEmailMock).toHaveBeenCalledWith({ newEmail: 'nuova@example.com', currentPassword: 'my-password' });
});

/** Fills the email form, submits it, and returns how the refusal was told. */
async function refusedEmailChange(error: { message: string; data: { code: string; unavailableReason?: string } }) {
  changeEmailMock.mockRejectedValue(error);
  const screen = await render(<UserProfileForm user={USER} />);
  await screen.getByLabelText('Cambia Email').fill('nuova@example.com');
  await screen.getByLabelText('Password attuale').fill('wrong-password');
  await screen.getByRole('button', { name: 'Aggiorna' }).click();
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
  return vi.mocked(toast.error).mock.calls[0];
}

test('a wrong current password is told as such, not as an expired session', async () => {
  const [title, options] = await refusedEmailChange({ message: 'Password attuale non corretta', data: { code: 'UNAUTHORIZED' } });

  expect(title).toBe('Errore cambio email');
  expect(options).toEqual({ description: 'Password attuale non corretta' });
});

test("a full account bucket is told with the server's text, signed in", async () => {
  const [, options] = await refusedEmailChange({
    message: 'Troppi tentativi: riprova tra qualche minuto',
    data: { code: 'TOO_MANY_REQUESTS' },
  });

  expect(options).toEqual({ description: 'Troppi tentativi: riprova tra qualche minuto' });
});

test.each([
  ['auth_unavailable', 'Servizio di autenticazione non disponibile. Riprova più tardi.'],
  ['maintenance', 'Sistema in manutenzione. Riprova più tardi.'],
])('a SERVICE_UNAVAILABLE for %s is told with its own text', async (unavailableReason, description) => {
  // A 5xx: production replaces its message, so the page shows the text of the reason the server sends.
  const [, options] = await refusedEmailChange({
    message: 'Internal server error',
    data: { code: 'SERVICE_UNAVAILABLE', unavailableReason },
  });

  expect(options).toEqual({ description });
});

// #230: the directory owns an LDAP account's address and rewrites it at every sign-in.
test('an LDAP account has no email change, and is told why', async () => {
  // Mounted once in the app (`Providers.tsx`): the names' sync tooltips need it.
  const screen = await render(
    <TooltipProvider>
      <UserProfileForm user={{ ...USER, provider: 'LDAP' }} />
    </TooltipProvider>
  );

  await expect.element(screen.getByText('Email gestita da LDAP: non si modifica dal profilo')).toBeInTheDocument();
  await expect.element(screen.getByLabelText('Cambia Email')).not.toBeInTheDocument();
  await expect.element(screen.getByRole('button', { name: 'Aggiorna' })).not.toBeInTheDocument();
});
