import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { APPROVAL_NEEDS_EMAIL_MESSAGE } from '@luke/core';

import { TooltipProvider } from '../../../../../../components/ui/tooltip';
import { PendingUsersTab } from '../PendingUsersTab';

/**
 * A pending user still on a synthetic LDAP address is approved only with a real address, which an
 * administrator (`*:*`) enters in the approval itself (#272). Whoever else may approve sees the
 * button disabled, saying why (#266, owner #69 a).
 */

const h = vi.hoisted(() => ({ can: { value: true }, admin: { value: true } }));

const pending = (username: string, email: string) => ({
  id: `id-${username}`,
  username,
  email,
  firstName: '',
  lastName: '',
  role: 'viewer',
  identities: [{ provider: 'LDAP' }],
  createdAt: '2026-11-17T09:00:00.000Z',
});

vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    users: {
      listPending: {
        useQuery: () => ({
          data: { users: [pending('nomail', 'nomail@ldap.local'), pending('withmail', 'withmail@example.com')], total: 2 },
          isLoading: false,
          error: null,
        }),
      },
      rejectPending: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));

vi.mock('../../../../../../hooks/usePermission', () => ({
  usePermission: () => ({ can: (permission: string) => h.can.value && (permission !== '*:*' || h.admin.value) }),
}));

vi.mock('../../../../../../hooks/useFormatDate', () => ({
  useFormatDate: () => ({ date: () => '17/11/2026' }),
}));

vi.mock('../../../../../../lib/refresh', () => ({ useRefresh: () => ({ users: vi.fn() }) }));

vi.mock('../../../../../../lib/useStandardMutation', () => ({
  useStandardMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

beforeEach(() => {
  h.can.value = true;
  h.admin.value = true;
});

// `delayDuration={0}`: the production provider's delay tests nothing here.
const tab = () => render(<TooltipProvider delayDuration={0}><PendingUsersTab /></TooltipProvider>);

const row = (screen: Awaited<ReturnType<typeof tab>>, username: string) => screen.getByRole('row').filter({ hasText: username });

/** Focuses the disabled button's tooltip wrapper in `username`'s row, as Tab would. */
function focusWrapper(screen: Awaited<ReturnType<typeof tab>>, username: string) {
  const wrapper = row(screen, username).element().querySelector<HTMLElement>('span[tabindex="0"]');
  if (!wrapper) throw new Error(`no focusable tooltip wrapper in the row of ${username}`);
  wrapper.focus();
}

test('an administrator may approve either: the address is given in the approval', async () => {
  const screen = await tab();

  await expect.element(row(screen, 'nomail').getByRole('button', { name: 'Approva' })).toBeEnabled();
  await expect.element(row(screen, 'withmail').getByRole('button', { name: 'Approva' })).toBeEnabled();
});

test('without *:*, a synthetic address: Approva disabled, saying why; a real one: enabled', async () => {
  h.admin.value = false;
  const screen = await tab();

  await expect.element(row(screen, 'nomail').getByRole('button', { name: 'Approva' })).toBeDisabled();
  await expect.element(row(screen, 'withmail').getByRole('button', { name: 'Approva' })).toBeEnabled();

  focusWrapper(screen, 'nomail');
  await expect.element(screen.getByText(APPROVAL_NEEDS_EMAIL_MESSAGE).first()).toBeVisible();
});

test('without the permission both actions stay visible, disabled, with the permission message', async () => {
  h.can.value = false;
  const screen = await tab();

  await expect.element(row(screen, 'withmail').getByRole('button', { name: 'Approva' })).toBeDisabled();
  await expect.element(row(screen, 'withmail').getByRole('button', { name: 'Rifiuta' })).toBeDisabled();

  focusWrapper(screen, 'withmail');
  await expect.element(screen.getByText('Non hai i permessi per approvare questo utente').first()).toBeVisible();
});
