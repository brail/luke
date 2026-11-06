import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { ContextGate } from '../ContextGate';

/**
 * The gate cannot be closed and covers the sidebar, so it offers its own `Logout`: a user it has
 * nothing to offer (no brand, no season) would otherwise stay signed in until the session expires
 * (#195). The sign-out path itself, error handling included, is `useLogout`'s, covered through the
 * sidebar in `AppSidebar.signOut.browser.test.tsx`.
 */

type LogoutOptions = {
  onSuccess: () => unknown;
  onError: (error: unknown) => void;
};

const h = vi.hoisted(() => ({
  signOut: vi.fn(),
  brands: {
    data: [] as Array<{ id: string; code: string; name: string }>,
    isLoading: false,
  },
}));

vi.mock('next-auth/react', () => ({ signOut: h.signOut }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../contexts/AppContextProvider', () => ({
  useAppContext: () => ({ needsSetup: true }),
}));
vi.mock('../../../contexts/useContextMutation', () => ({
  useContextMutation: () => ({ setContext: vi.fn(), isPending: false }),
}));
vi.mock('../../../hooks/usePermission', () => ({
  usePermission: () => ({ can: () => false }),
}));
vi.mock('../../../lib/trpc', () => {
  const idleMutation = {
    useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  };
  return {
    trpc: {
      useUtils: () => ({}),
      catalog: {
        brands: { useQuery: () => h.brands },
        seasons: { useQuery: () => ({ data: [], isLoading: false }) },
      },
      brand: { create: idleMutation },
      season: { create: idleMutation },
      auth: {
        logout: {
          useMutation: (options: LogoutOptions) => ({
            mutate: () => options.onSuccess(),
            isPending: false,
          }),
        },
      },
    },
  };
});

afterEach(() => {
  h.signOut.mockReset();
  h.brands = { data: [], isLoading: false };
});

test.each([
  ['no brand to choose', { data: [], isLoading: false }],
  [
    'brands to choose from, before choosing one',
    { data: [{ id: 'b1', code: 'B1', name: 'Brand 1' }], isLoading: false },
  ],
  ['the options still loading', { data: [], isLoading: true }],
])('signs out from the gate with %s', async (_case, brands) => {
  h.brands = brands;

  const screen = await render(<ContextGate />);
  // Not focused on open: a stray Enter must not sign the user out.
  await expect
    .element(screen.getByRole('button', { name: 'Logout' }))
    .not.toHaveFocus();
  await screen.getByRole('button', { name: 'Logout' }).click();

  await vi.waitFor(() =>
    expect(h.signOut).toHaveBeenCalledWith({ callbackUrl: '/login' })
  );
});
