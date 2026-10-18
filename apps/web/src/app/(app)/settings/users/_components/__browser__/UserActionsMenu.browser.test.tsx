import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { UserActionsMenu } from '../UserActionsMenu';

import type { UserActionHandlers, UserListItem } from '../types';

/**
 * "Gestisci accesso" opens the section-override editor, whose calls (`sectionAccess.getByUser`,
 * `set`) require `*:*`. It used to show for `users:update`, so an editor who manages users opened a
 * dialog that could only fail; it now shows for `*:*` alone. The rest of the menu still follows
 * `users:update`.
 */

const h = vi.hoisted(() => ({ held: new Set<string>() }));

vi.mock('../../../../../../hooks/usePermission', () => ({
  usePermission: () => ({ can: (permission: string) => h.held.has(permission) }),
}));
vi.mock('../../../../../../lib/refresh', () => ({ useRefresh: () => ({ users: vi.fn() }) }));
vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    auth: { requestEmailVerificationAdmin: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
    users: { forceVerifyEmail: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}));

const user: UserListItem = {
  id: 'u-1',
  email: 'mario@example.com',
  username: 'mario',
  firstName: 'Mario',
  lastName: 'Rossi',
  role: 'viewer',
  isActive: true,
  emailVerifiedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastLoginAt: null,
  identities: [{ id: 'i-1', provider: 'LOCAL', providerId: 'mario' }],
  isOnline: false,
};

// Every handler a no-op: the test only asks which entries the menu offers.
const handlers = new Proxy({}, { get: () => vi.fn() }) as UserActionHandlers;

async function openMenu() {
  const screen = await render(<UserActionsMenu user={user} currentUserId="someone-else" handlers={handlers} />);
  await screen.getByRole('button', { name: 'Apri menu' }).click();
  await expect.element(screen.getByRole('menuitem', { name: 'Modifica' })).toBeVisible();
  return screen;
}

beforeEach(() => {
  h.held.clear();
});

test('an editor who manages users is not offered the access editor', async () => {
  h.held = new Set(['users:update']);
  const screen = await openMenu();

  expect(screen.getByRole('menuitem', { name: 'Gestisci accesso' }).elements()).toHaveLength(0);
});

test('an administrator is', async () => {
  h.held = new Set(['users:update', 'users:delete', '*:*']);
  const screen = await openMenu();

  await expect.element(screen.getByRole('menuitem', { name: 'Gestisci accesso' })).toBeVisible();
});
