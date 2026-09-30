import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import LoginPage from '../page';

import type { ReactNode } from 'react';

/**
 * What the login page tells someone whose sign-in did not go through.
 *
 * Auth.js gives the page one `error` for every refused login; `code` is the only thing that tells
 * them apart. Two codes say nothing about the account — the login service is unavailable, or the
 * login is throttled — and used to read "Credenziali non valide" like everything else. They are
 * answered before the page asks the API whether the account is pending approval: that request
 * carries the username, and there is nothing to ask when the login was never judged.
 */

// Hoisted and stable: a fresh object per render would re-run every effect that depends on it.
const { signIn, router, utils } = vi.hoisted(() => ({
  signIn: vi.fn(),
  router: { push: vi.fn() },
  utils: { auth: { getPendingStatus: { fetch: vi.fn() } } },
}));

vi.mock('next-auth/react', () => ({ signIn }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
// `__esModule`: `next/link` is CommonJS, and once pre-bundled its default import goes through an
// interop that would otherwise hand the page this whole object as the component.
vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('../../../../lib/trpc', () => ({ trpc: { useUtils: () => utils } }));
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

beforeEach(() => {
  vi.clearAllMocks();
  utils.auth.getPendingStatus.fetch.mockResolvedValue({ isPending: false, needsEmail: false });
});

describe('a sign-in that did not go through', () => {
  test('an unavailable login service is said to be unavailable, and the account is not looked up', async () => {
    const screen = await signInRefusedWith('unavailable');

    await expect
      .element(screen.getByText('Servizio di autenticazione non disponibile. Riprova più tardi.'))
      .toBeVisible();
    expect(utils.auth.getPendingStatus.fetch).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
  });

  test('a throttled login is said to be throttled, and the account is not looked up', async () => {
    const screen = await signInRefusedWith('throttled');

    await expect.element(screen.getByText('Troppi tentativi. Riprova tra qualche minuto.')).toBeVisible();
    expect(utils.auth.getPendingStatus.fetch).not.toHaveBeenCalled();
  });

  test('refused credentials still read as such, after checking for a pending account', async () => {
    const screen = await signInRefusedWith('credentials');

    await expect.element(screen.getByText('Credenziali non valide')).toBeVisible();
    expect(utils.auth.getPendingStatus.fetch).toHaveBeenCalledWith({ username: 'alice' });
  });

  test('an account pending approval is sent to the pending page', async () => {
    utils.auth.getPendingStatus.fetch.mockResolvedValue({ isPending: true, needsEmail: true });

    await signInRefusedWith('credentials');

    await vi.waitFor(() => expect(router.push).toHaveBeenCalledWith('/auth/pending?u=alice&se=1'));
  });
});
