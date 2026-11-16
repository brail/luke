import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { UserDialog } from '../UserDialog';

/**
 * The admin user dialog reads the provider an account is synced from with `resolveEffectiveProvider`
 * (#230): a user holding a LOCAL and an LDAP identity is an LDAP user, whichever row comes first. An
 * LDAP user's email stays editable here, and the dialog says a directory with a mail rewrites it.
 */

// The password policy query, unanswered: the form uses its fallback policy.
vi.mock('../../lib/trpc', () => ({
  trpc: { public: { passwordPolicy: { useQuery: () => ({ data: undefined }) } } },
}));

const HINT = "Se la directory LDAP ha un indirizzo, lo riscrive al prossimo accesso dell'utente";

const user = (providers: ('LOCAL' | 'LDAP')[]) => ({
  id: 'u1',
  email: 'mario@example.com',
  username: 'mario',
  firstName: 'Mario',
  lastName: 'Rossi',
  role: 'editor' as const,
  isActive: true,
  identities: providers.map(provider => ({ provider })),
});

test('a user with a LOCAL identity first and an LDAP one is shown as LDAP', async () => {
  const screen = await render(
    <UserDialog open onOpenChange={() => undefined} mode="edit" user={user(['LOCAL', 'LDAP'])} onSubmit={() => undefined} />
  );

  await expect.element(screen.getByText(HINT)).toBeInTheDocument();
  await expect.element(screen.getByLabelText('Email *')).toBeEnabled();
});

test('a LOCAL user gets no directory hint', async () => {
  const screen = await render(
    <UserDialog open onOpenChange={() => undefined} mode="edit" user={user(['LOCAL'])} onSubmit={() => undefined} />
  );

  await expect.element(screen.getByLabelText('Email *')).toBeInTheDocument();
  await expect.element(screen.getByText(HINT)).not.toBeInTheDocument();
});
