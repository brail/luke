import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { AUTH_UNAVAILABLE_MESSAGE, SIGN_IN_REFUSED_MESSAGE } from '@luke/core';

import LoginPage from '../page';

import type { ReactNode } from 'react';

/**
 * What the login page tells someone whose sign-in did not go through.
 *
 * Auth.js gives the page one `error` for every refused login; `code` is the only thing that tells
 * them apart. Before the password is proven the page tells nothing apart — a wrong password, a
 * throttled login, a sign-in that failed outright all read `SIGN_IN_REFUSED_MESSAGE` — and it asks
 * nothing about the app's state (no maintenance read, no backend indicator). The codes the API
 * sends only once the password is proven — maintenance, a directory that could not complete the
 * login, email unverified, pending approval — each say what they are.
 *
 * Two more say the account awaits approval, and the API sends them only after the password is
 * proven. The page used to ask a public endpoint whether the username was pending after every
 * failed login, which told anyone which usernames were. It now learns it from the login itself,
 * shows the notice in place, and holds the password only while the email form needs it for
 * `auth.submitPendingEmail`.
 */

// Hoisted and stable: a fresh object per render would re-run every effect that depends on it.
const { signIn, router, submitPendingEmail, resendVerification, maintenanceStatus } = vi.hoisted(() => ({
  signIn: vi.fn(),
  router: { push: vi.fn() },
  submitPendingEmail: vi.fn(),
  resendVerification: vi.fn(),
  maintenanceStatus: vi.fn(),
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
        maintenance: { mode: { getStatus: { query: maintenanceStatus } } },
      },
    }),
  },
}));

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
  maintenanceStatus.mockResolvedValue({ status: 'INACTIVE' });
});

describe('a sign-in that did not go through', () => {
  test('a login the directory could not complete after proof is said to be unavailable', async () => {
    const screen = await signInRefusedWith('unavailable');

    await expect.element(screen.getByText(AUTH_UNAVAILABLE_MESSAGE)).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
    expect(maintenanceStatus).not.toHaveBeenCalled();
  });

  test('maintenance, answered after proof, is said to be maintenance', async () => {
    const screen = await signInRefusedWith('maintenance');

    await expect
      .element(screen.getByText('Sistema in manutenzione: accesso non disponibile. Riprova al termine.'))
      .toBeVisible();
    expect(maintenanceStatus).not.toHaveBeenCalled();
  });

  test.each(['credentials', 'throttled'])('a %s refusal reads the one pre-proof message', async code => {
    const screen = await signInRefusedWith(code);

    await expect.element(screen.getByText(SIGN_IN_REFUSED_MESSAGE)).toBeVisible();
    expect(maintenanceStatus).not.toHaveBeenCalled();
  });

  test('a sign-in that fails outright reads the one pre-proof message', async () => {
    signIn.mockRejectedValue(new TypeError('Failed to fetch'));
    const screen = await render(<LoginPage />);
    await screen.getByLabelText('Username').fill('alice');
    await screen.getByLabelText('Password').fill('her-password');
    await screen.getByRole('button', { name: 'Accedi' }).click();

    await expect.element(screen.getByText(SIGN_IN_REFUSED_MESSAGE)).toBeVisible();
  });

  test('the page shows no backend indicator', async () => {
    const screen = await render(<LoginPage />);

    await expect.element(screen.getByRole('button', { name: 'Accedi' })).toBeVisible();
    expect(screen.getByText('Servizio non disponibile').query()).toBeNull();
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

  test('a refused new link reads the server text, the one pre-proof message', async () => {
    resendVerification.mockRejectedValue(
      Object.assign(new Error(SIGN_IN_REFUSED_MESSAGE), { data: { code: 'UNAUTHORIZED' } }),
    );
    const screen = await signInRefusedWith('email_unverified');

    await screen.getByRole('button', { name: 'Invia di nuovo il link di verifica' }).click();

    await expect.element(screen.getByText(SIGN_IN_REFUSED_MESSAGE)).toBeVisible();
  });

  test('a new link the directory could not complete says unavailable, not maintenance', async () => {
    resendVerification.mockRejectedValue(
      Object.assign(new Error('Internal server error'), { data: { code: 'SERVICE_UNAVAILABLE' } }),
    );
    const screen = await signInRefusedWith('email_unverified');

    await screen.getByRole('button', { name: 'Invia di nuovo il link di verifica' }).click();

    await expect.element(screen.getByText(AUTH_UNAVAILABLE_MESSAGE)).toBeVisible();
  });

  test('refused credentials offer no new link', async () => {
    const screen = await signInRefusedWith('credentials');

    await expect.element(screen.getByText(SIGN_IN_REFUSED_MESSAGE)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Invia di nuovo il link di verifica' }).query()).toBeNull();
  });

  test('refused credentials read as such, and nothing about the account is asked or offered', async () => {
    const screen = await signInRefusedWith('credentials');

    await expect.element(screen.getByText(SIGN_IN_REFUSED_MESSAGE)).toBeVisible();
    expect(screen.getByLabelText('Indirizzo email').query()).toBeNull();
    expect(submitPendingEmail).not.toHaveBeenCalled();
  });
});

describe('an account pending approval', () => {
  test('is told so in place, with nothing to fill in; going back drops the password', async () => {
    const screen = await signInRefusedWith('pending');

    // This heading is shown; the form's `Accedi` is screen-reader-only beside the wordmark
    // (`toBeVisible` would pass on `sr-only`'s 1×1 px box).
    await expect.element(screen.getByRole('heading', { name: 'Richiesta ricevuta' })).not.toHaveClass('sr-only');
    await expect.element(screen.getByText('Il tuo accesso è in attesa di approvazione')).toBeVisible();
    expect(screen.getByLabelText('Indirizzo email').query()).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    await backToLogin(screen);
    await expect.element(screen.getByRole('heading', { name: 'Accedi' })).toHaveClass('sr-only');
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

  test('without an address, a save refused before proof reads the one pre-proof message', async () => {
    submitPendingEmail.mockRejectedValue(
      Object.assign(new Error(SIGN_IN_REFUSED_MESSAGE), { data: { code: 'UNAUTHORIZED' } }),
    );
    const screen = await signInRefusedWith('pending_email');

    await screen.getByLabelText('Indirizzo email').fill('alice@example.com');
    await screen.getByRole('button', { name: 'Salva email' }).click();

    await expect.element(screen.getByText(SIGN_IN_REFUSED_MESSAGE)).toBeVisible();
  });

  test('without an address, a save the directory could not complete says unavailable, not maintenance', async () => {
    submitPendingEmail.mockRejectedValue(
      Object.assign(new Error('Internal server error'), { data: { code: 'SERVICE_UNAVAILABLE' } }),
    );
    const screen = await signInRefusedWith('pending_email');

    await screen.getByLabelText('Indirizzo email').fill('alice@example.com');
    await screen.getByRole('button', { name: 'Salva email' }).click();

    await expect.element(screen.getByText(AUTH_UNAVAILABLE_MESSAGE)).toBeVisible();
  });

  test('without an address, leaving the form drops the password and saves nothing', async () => {
    const screen = await signInRefusedWith('pending_email');

    await expect.element(screen.getByLabelText('Indirizzo email')).toBeVisible();
    await backToLogin(screen);
    expect(submitPendingEmail).not.toHaveBeenCalled();
  });
});
