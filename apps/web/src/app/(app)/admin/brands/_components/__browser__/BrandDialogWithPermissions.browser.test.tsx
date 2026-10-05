import { type ComponentProps } from 'react';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../../components/ui/tooltip';
import { BrandDialogWithPermissions } from '../BrandDialogWithPermissions';

/**
 * The dialog answers three permission questions — may the user edit, is the user read-only, may
 * the user change the logo — from `brands:create`, `brands:update` and `brands:read`: edit is
 * create or update, read-only is read without create, the logo is update. No role grants update
 * without create, so the cases hold arbitrary permission sets through `hasPermission` instead of
 * real roles; the session only has to carry a role at all, and without one nothing is granted.
 */

const h = vi.hoisted((): { held: Set<string>; role: string | null } => ({ held: new Set(), role: 'editor' }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: h.role ? { user: { role: h.role }, accessToken: 't' } : null }),
}));
vi.mock('@luke/core', async importOriginal => ({
  ...(await importOriginal<typeof import('@luke/core')>()),
  hasPermission: (_user: unknown, permission: string) => h.held.has(permission),
}));
vi.mock('../../../../../../lib/trpc', () => ({
  trpc: { integrations: { nav: { brands: { list: { useQuery: () => ({ data: [] }) } } } } },
}));

type Brand = NonNullable<ComponentProps<typeof BrandDialogWithPermissions>['brand']>;
// Only the fields the dialog reads; the rest of a listed brand plays no part in these answers.
const brand = { id: 'b-1', code: 'nike', name: 'Nike', logoUrl: null, navBrandId: null, isActive: true } as Brand;

async function open(held: string[], options: { role?: string | null; brand?: Brand | null } = {}) {
  h.held = new Set(held);
  h.role = options.role === undefined ? 'editor' : options.role;
  return render(
    <TooltipProvider delayDuration={0}>
      <BrandDialogWithPermissions
        open
        onOpenChange={vi.fn()}
        brand={options.brand === undefined ? brand : options.brand}
        onSubmit={vi.fn()}
        isLoading={false}
      />
    </TooltipProvider>
  );
}

type Screen = Awaited<ReturnType<typeof open>>;

/**
 * Focuses the first `PermissionTooltip` wrapper inside the dialog, the focusable span a denied
 * control hangs off. Scoped to the dialog: Radix puts focus-guard spans with the same `tabindex`
 * at the edges of `<body>`.
 */
function focusFirstDeniedControl() {
  // `querySelector` types its result as `Element | null`; the span exists whenever a control is
  // denied, and a missing one throws here instead of letting the tooltip assertion pass on its own.
  (document.querySelector('[role="dialog"] span[tabindex="0"]') as HTMLElement).focus();
}

async function expectDialog(
  screen: Screen,
  want: { title: string; submit: string | null; cancel: string; banner: boolean; editable: boolean; logo: boolean }
) {
  await expect.element(screen.getByRole('heading', { name: want.title })).toBeVisible();
  for (const label of ['Aggiorna', 'Crea']) {
    expect(screen.getByRole('button', { name: label, exact: true }).elements()).toHaveLength(label === want.submit ? 1 : 0);
  }
  await expect.element(screen.getByRole('button', { name: want.cancel, exact: true })).toBeVisible();
  expect(screen.getByText('Hai accesso sola lettura', { exact: false }).elements()).toHaveLength(want.banner ? 1 : 0);
  const name = screen.getByPlaceholder('es. Nike, Adidas');
  await (want.editable ? expect.element(name).toBeEnabled() : expect.element(name).toBeDisabled());
  expect(screen.getByText('Trascina qui o clicca per caricare').elements()).toHaveLength(want.logo ? 1 : 0);
  expect(screen.getByText('Sola lettura', { exact: true }).elements()).toHaveLength(want.logo ? 0 : 1);
}

test('create, update and read: edits everything, logo included', async () => {
  const screen = await open(['brands:read', 'brands:create', 'brands:update', 'brands:delete']);
  await expectDialog(screen, { title: 'Modifica Brand', submit: 'Aggiorna', cancel: 'Annulla', banner: false, editable: true, logo: true });
});

test('read alone: a read-only view with the banner and no submit', async () => {
  const screen = await open(['brands:read']);
  await expectDialog(screen, { title: 'Visualizza Brand', submit: null, cancel: 'Chiudi', banner: true, editable: false, logo: false });

  focusFirstDeniedControl();
  await expect.element(screen.getByText('Accesso sola lettura - non puoi modificare i brand')).toBeVisible();
});

test('update without create: read-only by title and banner, yet it edits and changes the logo', async () => {
  const screen = await open(['brands:read', 'brands:update']);
  await expectDialog(screen, { title: 'Visualizza Brand', submit: 'Aggiorna', cancel: 'Chiudi', banner: true, editable: true, logo: true });
});

test('create without update: edits the fields but not the logo', async () => {
  const screen = await open(['brands:read', 'brands:create']);
  await expectDialog(screen, { title: 'Modifica Brand', submit: 'Aggiorna', cancel: 'Annulla', banner: false, editable: true, logo: false });
});

test('no brand permission: nothing editable, and the tooltip says why', async () => {
  const screen = await open([]);
  await expectDialog(screen, { title: 'Modifica Brand', submit: null, cancel: 'Annulla', banner: false, editable: false, logo: false });

  focusFirstDeniedControl();
  await expect.element(screen.getByText('Non hai i permessi necessari per modificare i brand')).toBeVisible();
});

test('no role in the session: nothing is granted, whatever the permission table says', async () => {
  const screen = await open(['brands:read', 'brands:create', 'brands:update'], { role: null });
  await expectDialog(screen, { title: 'Modifica Brand', submit: null, cancel: 'Annulla', banner: false, editable: false, logo: false });
});

test('create mode with create alone: a new brand can be created', async () => {
  const screen = await open(['brands:create'], { brand: null });
  await expectDialog(screen, { title: 'Nuovo Brand', submit: 'Crea', cancel: 'Annulla', banner: false, editable: true, logo: false });
});
