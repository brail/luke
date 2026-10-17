import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { VendorDialog } from '../VendorDialog';

import type { VendorItem } from '../VendorTable';

/**
 * The vendor dialog: its colour minimum is required on every save (#124), wherever the save is
 * pressed from, and it hosts the vendor closures, whose own dialog renders through a portal while
 * sitting inside the vendor form — a closure saved there must not also submit the vendor.
 */

const { upsertClosure, closures } = vi.hoisted(() => ({
  upsertClosure: vi.fn(),
  closures: {
    data: [{
      id: 'c1', name: 'Ferie', countryCode: null, type: 'CLOSURE', notes: null, confirmedAt: null,
      startDate: '2026-08-10T00:00:00.000Z', endDate: '2026-08-21T00:00:00.000Z',
    }],
  },
}));

vi.mock('../../../../../../lib/trpc', () => {
  const idleMutation = () => ({ mutate: () => undefined, isPending: false });
  return {
    trpc: {
      pricing: { parameterSets: { list: { useQuery: () => ({ data: [] }) } } },
      holidays: {
        listCountries: { useQuery: () => ({ data: [] }) },
        listVendorClosures: { useQuery: () => closures },
        upsertVendorClosure: { useMutation: () => ({ mutate: upsertClosure, isPending: false }) },
        deleteVendorClosure: { useMutation: idleMutation },
        confirmVendorClosures: { useMutation: idleMutation },
        prefillVendorClosures: { useMutation: idleMutation },
      },
    },
  };
});
vi.mock('../../../../../../contexts/AppContextProvider', () => ({
  useAppContext: () => ({ brand: null, season: { id: 's1', name: 'FW26' } }),
}));
vi.mock('../../../../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const vendor: VendorItem = {
  id: 'v1', name: 'Fornitore', countryCode: null, nickname: null, referente: null, email: null,
  phone: null, chat: null, notes: null, navVendorId: null, isActive: true,
  moqPerLine: null, moqPerModel: null, moqPerColor: null,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', enabledParameterSets: [],
};
const COLOUR_REQUIRED = 'Inserisci il minimo per colore: un numero intero di paia tra 1 e 100000';

async function renderDialog(forVendor: VendorItem | null) {
  const onSubmit = vi.fn(async () => undefined);
  const screen = await render(
    <VendorDialog open onOpenChange={vi.fn()} vendor={forVendor} onSubmit={onSubmit} isLoading={false} />
  );
  return { onSubmit, screen };
}

afterEach(() => upsertClosure.mockReset());

test('saving a closure does not submit the vendor', async () => {
  // A valid vendor: an invalid one would be refused anyway, and the test would prove nothing.
  const { onSubmit, screen } = await renderDialog({ ...vendor, moqPerColor: 300 });

  await screen.getByRole('tab', { name: 'Chiusure' }).click();
  await screen.getByRole('cell', { name: 'Ferie' }).click();
  await screen.getByRole('button', { name: 'Salva' }).click();

  await vi.waitFor(() => expect(upsertClosure).toHaveBeenCalledTimes(1));
  expect(onSubmit).not.toHaveBeenCalled();
});

test('a new vendor is not saved without the colour minimum', async () => {
  const { onSubmit, screen } = await renderDialog(null);

  await screen.getByLabelText('Ragione Sociale *').fill('Acme');
  await screen.getByRole('button', { name: 'Crea' }).click();
  await expect.element(screen.getByText(COLOUR_REQUIRED)).toBeVisible();
  expect(onSubmit).not.toHaveBeenCalled();

  await screen.getByLabelText('Minimo per colore *').fill('300');
  await screen.getByRole('button', { name: 'Crea' }).click();
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ moqPerColor: 300, moqPerLine: null, moqPerModel: null }))
  );
});

test('a vendor with no minimums opens empty and saves once the colour minimum is filled in', async () => {
  const { onSubmit, screen } = await renderDialog(vendor);

  await expect.element(screen.getByLabelText('Minimo per colore *')).toHaveValue(null);
  await screen.getByRole('button', { name: 'Aggiorna' }).click();
  await expect.element(screen.getByText(COLOUR_REQUIRED)).toBeVisible();
  expect(onSubmit).not.toHaveBeenCalled();

  await screen.getByLabelText('Minimo per colore *').fill('300');
  await screen.getByLabelText('Minimo per linea').fill('1200');
  await screen.getByRole('button', { name: 'Aggiorna' }).click();
  await vi.waitFor(() =>
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ moqPerColor: 300, moqPerLine: 1200 }))
  );
});

test('an invalid save pressed from the closures tab brings back the tab with the error', async () => {
  const { onSubmit, screen } = await renderDialog(vendor);

  await screen.getByRole('tab', { name: 'Chiusure' }).click();
  await screen.getByRole('button', { name: 'Aggiorna' }).click();

  await expect.element(screen.getByText(COLOUR_REQUIRED)).toBeVisible();
  expect(onSubmit).not.toHaveBeenCalled();
});

test('recorded minimums open in the fields', async () => {
  const { screen } = await renderDialog({ ...vendor, moqPerColor: 300, moqPerModel: 600 });

  await expect.element(screen.getByLabelText('Minimo per colore *')).toHaveValue(300);
  await expect.element(screen.getByLabelText('Minimo per modello')).toHaveValue(600);
  await expect.element(screen.getByLabelText('Minimo per linea')).toHaveValue(null);
});
