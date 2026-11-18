import { afterEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { EditTeamDialog } from '../TeamDialog';

/**
 * The team dialog reads the users list only to pick new members, so only whoever can edit the team
 * loads it; the read-only view lists members from the team's own memberships.
 */

const h = vi.hoisted(() => ({
  permissions: new Set<string>(),
  mutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  usersList: vi.fn((_input: unknown, _opts: { enabled: boolean }): { data: unknown } => ({ data: undefined })),
  // Stable across renders: the dialog copies it into local state from an effect.
  team: {
    id: 't1',
    name: 'Team',
    description: null,
    brandScopes: [],
    memberships: [{ userId: 'u1', role: 'MEMBER', user: { id: 'u1', username: 'member', firstName: 'Maria', lastName: 'Rossi' } }],
  },
}));

vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    company: {
      team: {
        getById: { useQuery: () => ({ data: h.team, isLoading: false }) },
        listAllBrands: { useQuery: () => ({ data: [] }) },
        update: { useMutation: h.mutation },
        addMembers: { useMutation: h.mutation },
        removeMembers: { useMutation: h.mutation },
      },
    },
    users: { list: { useQuery: h.usersList } },
  },
}));

vi.mock('../../../../../../hooks/usePermission', () => ({
  usePermission: () => ({ can: (permission: string) => h.permissions.has(permission) }),
}));

vi.mock('../../../../../../lib/refresh', () => ({ useRefresh: () => ({ company: vi.fn() }) }));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const dialog = () => <EditTeamDialog open teamId="t1" onClose={() => undefined} onSaved={() => undefined} />;

afterEach(() => {
  vi.resetAllMocks();
});

test('the read-only view does not load the users list and still lists the members', async () => {
  h.permissions = new Set(['company_team:read']);
  const screen = await render(dialog());

  await userEvent.click(screen.getByRole('tab', { name: /Membri/ }));

  await expect.element(screen.getByText('Maria Rossi')).toBeInTheDocument();
  expect(h.usersList).toHaveBeenCalled();
  expect(h.usersList).not.toHaveBeenCalledWith(expect.anything(), { enabled: true });
});

test('an editor of the team who may not list users gets no users query', async () => {
  h.permissions = new Set(['company_team:update']);
  await render(dialog());

  expect(h.usersList).toHaveBeenCalled();
  expect(h.usersList).not.toHaveBeenCalledWith(expect.anything(), { enabled: true });
});

test('whoever can edit the team and list users picks new members from the list', async () => {
  h.permissions = new Set(['company_team:update', 'users:read']);
  h.usersList.mockReturnValue({
    data: { users: [{ id: 'u2', email: 'n@example.com', username: 'newcomer', firstName: null, lastName: null, isActive: true }] },
  });
  const screen = await render(dialog());

  await userEvent.click(screen.getByRole('tab', { name: /Membri/ }));

  expect(h.usersList).toHaveBeenCalledWith({ limit: 100 }, { enabled: true });
  await expect.element(screen.getByText('Aggiungi membro…')).toBeInTheDocument();
});
