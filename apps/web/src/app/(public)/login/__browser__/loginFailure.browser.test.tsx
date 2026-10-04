import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import LoginPage from '../page';

import type { ReactNode } from 'react';

/**
 * What the login page tells someone whose sign-in did not go through.
 *
 * Auth.js gives the page one `error` for every refused login; `code` is the only thing that tells
 * them apart. Two codes say nothing about the account — the login service is unavailable, or the
 * login is throttled — and used to read "Credenziali non valide" like everything else.
 *
 * Two more say the account awaits approval, and the API sends them only after the password is
 * proven. The page used to ask a public endpoint whether the username was pending after every
 * failed login, which told anyone which usernames were. It now learns it from the login itself,
 * shows the notice in place, and holds the password only while the email form needs it for
 * `auth.submitPendingEmail`.
 */

// Hoisted and stable: a fresh object per render would re-run every effect that depends on it.
const { signIn, router, submitPendingEmail, resendVerification } = vi.hoisted(() => ({
  signIn: vi.fn(),
  router: { push: vi.fn() },
  submitPendingEmail: vi.fn(),
  resendVerification: vi.fn(),
}));

vi.mock('next-auth/react', () => ({ signIn }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
// `__esModule`: `next/link` is CommonJS, and once pre-bundled its default import goes through an
// interop that would otherwise hand the page this whole object as the component.
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
// The vanilla client and nothing else: a mutation hook would keep the password in TanStack's cache
// after the call settles, so the page must not use one — and against this mock it cannot.
vi.mock('../../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      client: {
        auth: {
          submitPendingEmail: { mutate: submitPendingEmail },
          resendVerification: { mutate: resendVerification },
        },
      },
    }),
  },
}));
// Page furniture with requests and images of its own, irrelevant to the form.
vi.mock('../../../../components/AppVersionLabel', () => ({ AppVersionLabel: () => null }));
vi.mock('../../../../components/BackendStatus', () => ({ BackendStatus: () => null }));
vi.mock('../../../../components/Logo', () => ({ default: () => null }));

/** Fills the form and submits it; `signIn` answers as Auth.js does for a refused login. */
async function signInRefusedWith(code: string) {
  signIn.mockResolvedValue({ error: 'CredentialsSignin', code, status: 200, ok: true, url: null });
  const screen = await render(<LoginPage />);
  await screen.getByLabelText('Username').fill('alice');
  await screen.getByLabelText('Password').fill('her-password');
  await screen.getByRole('button', { name: 'Accedi' }).click();
  return screen;
}

/** Back to the form: the username stays, the password must not. */
async function backToLogin(screen: Awaited<ReturnType<typeof render>>) {
  await screen.getByRole('button', { name: 'Torna al login' }).click();
  await expect.element(screen.getByLabelText('Username')).toHaveValue('alice');
  await expect.element(screen.getByLabelText('Password')).toHaveValue('');
}

beforeEach(() => {
  vi.clearAllMocks();
  submitPendingEmail.mockResolvedValue({ success: true });
  resendVerification.mockResolvedValue({ success: true });
});

describe('a sign-in that did not go through', () => {
  test('an unavailable login service is said to be unavailable', async () => {
    const screen = await signInRefusedWith('unavailable');

    await expect
      .element(screen.getByText('Servizio di autenticazione non disponibile. Riprova più tardi.'))
      .toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
  });

  test('a throttled login is said to be throttled', async () => {
    const screen = await signInRefusedWith('throttled');

    await expect.element(screen.getByText('Troppi tentativi. Riprova tra qualche minuto.')).toBeVisible();
  });

  test('an email still to verify is said so, once the password is proven', async () => {
    const screen = await signInRefusedWith('email_unverified');

    await expect
      .element(screen.getByText('Email non verificata. Controlla la tua casella di posta per il link di verifica.'))
      .toBeVisible();
  });

  test('an email still to verify can ask for a new link, with the credentials just proven', async () => {
    const screen = await signInRefusedWith('email_unverified');

    await screen.getByRole('button', { name: 'Invia di nuovo il link di verifica' }).click();

    expect(resendVerification).toHaveBeenCalledWith({ username: 'alice', password: 'her-password' });
    await expect.element(screen.getByText('Ti abbiamo inviato un nuovo link di verifica.')).toBeVisible();
    expect(screen.getByText(/Email non verificata/).query()).toBeNull();
  });

  test('refused credentials offer no new link', async () => {
    const screen = await signInRefusedWith('credentials');

    await expect.element(screen.getByText('Credenziali non valide')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Invia di nuovo il link di verifica' }).query()).toBeNull();
  });

  test('refused credentials read as such, and nothing about the account is asked or offered', async () => {
    const screen = await signInRefusedWith('credentials');

    await expect.element(screen.getByText('Credenziali non valide')).toBeVisible();
    expect(screen.getByLabelText('Indirizzo email').query()).toBeNull();
    expect(submitPendingEmail).not.toHaveBeenCalled();
  });
});

describe('an account pending approval', () => {
  test('is told so in place, with nothing to fill in; going back drops the password', async () => {
    const screen = await signInRefusedWith('pending');

    await expect.element(screen.getByText('Il tuo accesso è in attesa di approvazione')).toBeVisible();
    expect(screen.getByLabelText('Indirizzo email').query()).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    await backToLogin(screen);
  });

  test('without an address, saves the one it is given with the password just proven; going back drops it', async () => {
    const screen = await signInRefusedWith('pending_email');

    await screen.getByLabelText('Indirizzo email').fill('alice@example.com');
    await screen.getByRole('button', { name: 'Salva email' }).click();

    expect(submitPendingEmail).toHaveBeenCalledWith({
      username: 'alice',
      password: 'her-password',
      email: 'alice@example.com',
    });
    await expect.element(screen.getByText(/Email salvata/)).toBeVisible();
    await backToLogin(screen);
  });

  test('without an address, a refused save says why and keeps the form', async () => {
    submitPendingEmail.mockRejectedValue(
      Object.assign(new Error('Email già in uso da un altro account'), { data: { code: 'CONFLICT' } }),
    );
    const screen = await signInRefusedWith('pending_email');

    await screen.getByLabelText('Indirizzo email').fill('taken@example.com');
    await screen.getByRole('button', { name: 'Salva email' }).click();

    await expect.element(screen.getByText('Email già in uso da un altro account')).toBeVisible();
    await expect.element(screen.getByLabelText('Indirizzo email')).toHaveValue('taken@example.com');
  });

  test('without an address, leaving the form drops the password and saves nothing', async () => {
    const screen = await signInRefusedWith('pending_email');

    await expect.element(screen.getByLabelText('Indirizzo email')).toBeVisible();
    await backToLogin(screen);
    expect(submitPendingEmail).not.toHaveBeenCalled();
  });
});
