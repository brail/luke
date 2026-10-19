import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import AppSidebar from '../AppSidebar';
import { SidebarProvider } from '../ui/sidebar';

/**
 * The sign-out button ends the API sessions (`auth.logout`) before the browser's: it signs out once
 * the API ended them, or answered UNAUTHORIZED (nothing left to end); on any other answer the user
 * stays signed in and is told, so the button can be pressed again.
 */

type LogoutOptions = { onSuccess: () => unknown; onError: (error: unknown) => void };

const h = vi.hoisted(() => ({
  signOut: vi.fn(),
  toastError: vi.fn(),
  /** What `auth.logout` answers: `null` for success, or the error it fails with. */
  answer: null as unknown,
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { firstName: 'Ada', lastName: 'Rossi' } }, status: 'authenticated' }),
  signOut: h.signOut,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
vi.mock('sonner', () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock('../../hooks/useMenuAccess', () => ({ useMenuAccess: () => ({ showSystemSection: false }) }));
vi.mock('../../hooks/useMenuPreferences', () => ({
  useMenuPreferences: () => ({ menuStates: {}, toggleMenu: vi.fn() }),
}));
vi.mock('../FeedbackDialog', () => ({ FeedbackDialog: () => null }));
vi.mock('../../lib/trpc', () => ({
  trpc: {
    auth: {
      logout: {
        useMutation: (options: LogoutOptions) => ({
          mutate: () => (h.answer === null ? options.onSuccess() : options.onError(h.answer)),
          isPending: false,
        }),
      },
    },
  },
}));

// A desktop width: below 768 px the sidebar is a closed sheet.
beforeEach(() => page.viewport(1280, 800));

afterEach(() => {
  h.signOut.mockReset();
  h.toastError.mockReset();
  h.answer = null;
});

async function pressSignOut() {
  const screen = await render(
    <SidebarProvider>
      <AppSidebar />
    </SidebarProvider>
  );
  await screen.getByText('Ada Rossi').click();
  await screen.getByRole('menuitem', { name: 'Logout' }).click();
}

test('signs out once the API has ended the sessions', async () => {
  await pressSignOut();

  await vi.waitFor(() => expect(h.signOut).toHaveBeenCalledWith({ callbackUrl: '/login' }));
  expect(h.toastError).not.toHaveBeenCalled();
});

test('signs out when the API answers UNAUTHORIZED: the bearer is already revoked or expired', async () => {
  h.answer = { data: { code: 'UNAUTHORIZED' } };

  await pressSignOut();

  await vi.waitFor(() => expect(h.signOut).toHaveBeenCalledWith({ callbackUrl: '/login' }));
  expect(h.toastError).not.toHaveBeenCalled();
});

test('stays signed in during maintenance, and says why', async () => {
  h.answer = { data: { code: 'SERVICE_UNAVAILABLE' } };

  await pressSignOut();

  await vi.waitFor(() =>
    expect(h.toastError).toHaveBeenCalledWith('Uscita non disponibile durante la manutenzione: riprova al termine')
  );
  expect(h.signOut).not.toHaveBeenCalled();
});

test('stays signed in on any other failure, so the user can retry', async () => {
  // A network failure: a client error with no tRPC code.
  h.answer = { message: 'Failed to fetch', data: undefined };

  await pressSignOut();

  await vi.waitFor(() => expect(h.toastError).toHaveBeenCalledWith('Uscita non riuscita: riprova'));
  expect(h.signOut).not.toHaveBeenCalled();
});
