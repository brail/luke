import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { VendorDialog } from '../VendorDialog';

import type { VendorItem } from '../VendorTable';

/**
 * The vendor dialog hosts the vendor closures, whose own dialog renders through a portal while
 * sitting inside the vendor form: a closure saved there must not also submit the vendor.
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
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', enabledParameterSets: [],
};

async function renderDialog(forVendor: VendorItem | null) {
  const onSubmit = vi.fn(async () => undefined);
  const screen = await render(
    <VendorDialog open onOpenChange={vi.fn()} vendor={forVendor} onSubmit={onSubmit} isLoading={false} />
  );
  return { onSubmit, screen };
}

afterEach(() => upsertClosure.mockReset());

test('saving a closure does not submit the vendor', async () => {
  const { onSubmit, screen } = await renderDialog(vendor);

  await screen.getByRole('tab', { name: 'Chiusure' }).click();
  await screen.getByRole('cell', { name: 'Ferie' }).click();
  await screen.getByRole('button', { name: 'Salva' }).click();

  await vi.waitFor(() => expect(upsertClosure).toHaveBeenCalledTimes(1));
  expect(onSubmit).not.toHaveBeenCalled();
});
