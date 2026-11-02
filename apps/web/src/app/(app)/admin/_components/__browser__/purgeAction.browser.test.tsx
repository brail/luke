import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../components/ui/tooltip';
import { BrandTableWithPermissions, type Brand } from '../../brands/_components/BrandTableWithPermissions';
import { SeasonTable } from '../../seasons/_components/SeasonTable';
import { PurgeConfirmDialog } from '../PurgeConfirmDialog';

import type { SeasonItem } from '../../seasons/_components/SeasonDialog';

/**
 * A test brand or season is purged from its admin page: the action shows only on an inactive row
 * with no NAV link, and the dialog says what goes and unlocks only on the entity's name.
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: 'admin' }, accessToken: 't' } }),
}));
// The tables print dates in the profile zone, which `useFormatDate` reads through tRPC.
vi.mock('../../../../../hooks/useFormatDate', () => ({
  useFormatDate: () => ({ date: (value: unknown) => String(value) }),
}));

const preview = {
  name: 'Test Brand',
  counts: {
    layouts: 1, groups: 2, rows: 5, quotations: 0, revisions: 1, calendars: 1, planningGroups: 1,
    events: 3, merchandisingPlans: 0, merchandisingRows: 0, parameterSets: 1, teamBrandScopes: 0,
  },
  involved: ['SS 2030'],
  keptPictureReferences: 2,
  outside: { rows: 0, events: 0, quotations: 0, merchandisingRows: 0 },
};

function dialog(props: Partial<Parameters<typeof PurgeConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const screen = render(
    <TooltipProvider delayDuration={0}>
      <PurgeConfirmDialog
        open
        onOpenChange={vi.fn()}
        kind="brand"
        name="Test Brand"
        preview={preview}
        onConfirm={onConfirm}
        {...props}
      />
    </TooltipProvider>
  );
  return { screen, onConfirm };
}

test('the dialog lists what goes and what stays, and confirms only on the exact name', async () => {
  const { screen, onConfirm } = dialog();
  const view = await screen;
  const alert = view.getByRole('alertdialog');

  await expect.element(alert.getByText(/righe: 5/)).toBeVisible();
  await expect.element(alert.getByText(/eventi: 3/)).toBeVisible();
  await expect.element(alert.getByText(/quotazioni/)).not.toBeInTheDocument();
  await expect.element(alert.getByText(/SS 2030/)).toBeVisible();
  await expect.element(alert.getByText(/2 foto delle revisioni restano/)).toBeVisible();

  const action = alert.getByRole('button', { name: 'Elimina con i dati' });
  await alert.getByRole('textbox').fill('Test Bran');
  await expect.element(action).toBeDisabled();
  await alert.getByRole('textbox').fill('Test Brand');
  await action.click();

  expect(onConfirm).toHaveBeenCalledWith('Test Brand');
});

const blocked = { ...preview, outside: { rows: 2, events: 0, quotations: 1, merchandisingRows: 0 } };

test.each([
  ['still loading', { preview: undefined }, /Calcolo di cosa verrà eliminato/],
  ['refused', { preview: undefined, previewError: new Error('Disattiva prima il brand') }, /Impossibile calcolare/],
  ['blocked from outside', { preview: blocked }, /altri brand o stagioni/],
])('the dialog stays locked and says why when the preview is %s', async (_case, props, reason) => {
  const alert = (await dialog(props).screen).getByRole('alertdialog');

  await expect.element(alert.getByText(reason)).toBeVisible();
  await alert.getByRole('textbox').fill('Test Brand');
  await expect.element(alert.getByRole('button', { name: 'Elimina con i dati' })).toBeDisabled();
});

const brand = (over: Partial<Brand>): Brand => ({
  id: 'b', code: 'B', name: 'B', logoKey: null, logoUrl: null, navBrandId: null, isActive: true,
  createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z', ...over,
});

test('the brand table offers the purge only on an inactive brand with no NAV link', async () => {
  const onPurge = vi.fn();
  const screen = await render(
    <TooltipProvider delayDuration={0}>
      <BrandTableWithPermissions
        brands={[
          brand({ id: 'active', name: 'Active' }),
          brand({ id: 'nav', name: 'Nav', isActive: false, navBrandId: 'N1' }),
          brand({ id: 'test', name: 'Test', isActive: false }),
        ]}
        isLoading={false}
        onEdit={vi.fn()} onDelete={vi.fn()} onRestore={vi.fn()} onUnlink={vi.fn()} onHardDelete={vi.fn()}
        onPurge={onPurge}
      />
    </TooltipProvider>
  );

  const buttons = screen.getByRole('button', { name: 'Elimina con i dati' });
  await expect.element(buttons).toHaveLength(1);
  await buttons.click();

  expect(onPurge).toHaveBeenCalledWith(expect.objectContaining({ id: 'test' }));
});

const season = (over: Partial<SeasonItem>): SeasonItem =>
  ({ id: 's', code: 'S', name: 'S', year: 2030, navSeasonId: null, isActive: true, updatedAt: '2030-01-01T00:00:00Z', ...over });

test('the season table offers the purge only on an inactive season with no NAV link', async () => {
  const onPurge = vi.fn();
  const screen = await render(
    <TooltipProvider delayDuration={0}>
      <SeasonTable
        seasons={[
          season({ id: 'active', name: 'Active' }),
          season({ id: 'nav', name: 'Nav', isActive: false, navSeasonId: 'N1' }),
          season({ id: 'test', name: 'Test', isActive: false }),
        ]}
        isLoading={false}
        onEdit={vi.fn()} onDelete={vi.fn()} onRestore={vi.fn()} onUnlink={vi.fn()} onHardDelete={vi.fn()}
        onPurge={onPurge}
      />
    </TooltipProvider>
  );

  const buttons = screen.getByRole('button', { name: 'Elimina con i dati' });
  await expect.element(buttons).toHaveLength(1);
  await buttons.click();

  expect(onPurge).toHaveBeenCalledWith(expect.objectContaining({ id: 'test' }));
});
