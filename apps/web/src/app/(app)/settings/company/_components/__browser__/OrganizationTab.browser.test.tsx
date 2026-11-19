import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../../components/ui/tooltip';
import { OrganizationTab } from '../OrganizationTab';

/**
 * The organization tab lists the company functions to whoever may read them; the team list of the
 * selected function, and its query, come with the team read.
 */

const h = vi.hoisted(() => ({
  permissions: new Set<string>(),
  mutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
  // Stable across renders: the tab selects the first function from an effect.
  functions: [{ id: 'f1', name: 'Design', description: 'Prodotto e stile', isActive: true, order: 1, slug: 'design' }],
  listByFunction: vi.fn((_input: unknown) => ({ data: [], isLoading: false })),
}));

vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    company: {
      function: {
        list: { useQuery: () => ({ data: h.functions }) },
        create: { useMutation: h.mutation },
        update: { useMutation: h.mutation },
        delete: { useMutation: h.mutation },
        restore: { useMutation: h.mutation },
        reorder: { useMutation: h.mutation },
      },
      // The team list and its dialogs, mounted with the team read.
      team: {
        listByFunction: { useQuery: h.listByFunction },
        getById: { useQuery: () => ({ data: undefined, isLoading: false }) },
        listAllBrands: { useQuery: () => ({ data: [] }) },
        create: { useMutation: h.mutation },
        update: { useMutation: h.mutation },
        delete: { useMutation: h.mutation },
        addMembers: { useMutation: h.mutation },
        removeMembers: { useMutation: h.mutation },
      },
    },
    users: { list: { useQuery: () => ({ data: undefined }) } },
  },
}));

vi.mock('../../../../../../hooks/usePermission', () => ({
  usePermission: () => ({ can: (permission: string) => h.permissions.has(permission) }),
}));

vi.mock('../../../../../../lib/refresh', () => ({ useRefresh: () => ({ company: vi.fn() }) }));

// The app mounts TooltipProvider once (components/Providers.tsx); the permission tooltips need it.
const tab = () => render(<TooltipProvider delayDuration={0}><OrganizationTab /></TooltipProvider>);

afterEach(() => {
  vi.clearAllMocks();
});

test('with the function read only, the functions show and the teams are not asked for', async () => {
  h.permissions = new Set(['company_function:read']);
  const screen = await tab();

  await expect.element(screen.getByRole('heading', { name: 'Design' })).toBeVisible();
  await expect.element(screen.getByText('Prodotto e stile')).toBeVisible();
  expect(h.listByFunction).not.toHaveBeenCalled();
});

test('with the team read as well, the selected function lists its teams', async () => {
  h.permissions = new Set(['company_function:read', 'company_team:read']);
  await tab();

  await expect.poll(() => h.listByFunction.mock.calls.at(-1)?.[0]).toEqual({ functionId: 'f1' });
});
