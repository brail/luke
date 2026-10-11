import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { VendorClosurePeriodManager } from '../VendorClosurePeriodManager';

/**
 * A closure's dates are calendar days (ADR-035): the dialog sends the `yyyy-mm-dd` it shows, never
 * an instant the server would have to read back as a day, and the table writes them like every
 * other date.
 */

const { upsertMock, idleMutation, closures } = vi.hoisted(() => ({
  upsertMock: vi.fn(),
  idleMutation: () => ({ mutate: () => undefined, isPending: false }),
  // The days travel as UTC midnights.
  closures: {
    data: [{
      id: 'c1', name: 'Ferie', countryCode: null, type: 'CLOSURE', notes: null, confirmedAt: null,
      startDate: '2026-08-10T00:00:00.000Z', endDate: '2026-08-21T00:00:00.000Z',
    }],
  },
}));

vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    holidays: {
      listCountries: { useQuery: () => ({ data: [] }) },
      listVendorClosures: { useQuery: () => closures },
      upsertVendorClosure: { useMutation: () => ({ mutate: upsertMock, isPending: false }) },
      deleteVendorClosure: { useMutation: idleMutation },
      confirmVendorClosures: { useMutation: idleMutation },
      prefillVendorClosures: { useMutation: idleMutation },
    },
  },
}));
vi.mock('../../../../../../contexts/AppContextProvider', () => ({
  useAppContext: () => ({ season: { id: 's1', name: 'FW26' } }),
}));
vi.mock('../../../../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => upsertMock.mockReset());

test('the table writes a closure\'s days like every other date', async () => {
  const screen = await render(<VendorClosurePeriodManager vendorId="v1" vendorName="Fornitore" />);

  await expect.element(screen.getByRole('cell', { name: '10/08/2026' })).toBeInTheDocument();
  await expect.element(screen.getByRole('cell', { name: '21/08/2026' })).toBeInTheDocument();
});

test('an edited closure is saved as the calendar days it shows', async () => {
  const screen = await render(<VendorClosurePeriodManager vendorId="v1" vendorName="Fornitore" />);

  await screen.getByRole('cell', { name: 'Ferie' }).click();
  await expect.element(screen.getByLabelText('Data inizio')).toHaveValue('2026-08-10');
  await screen.getByRole('button', { name: 'Salva' }).click();

  await vi.waitFor(() => expect(upsertMock).toHaveBeenCalledTimes(1));
  expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ startDate: '2026-08-10', endDate: '2026-08-21' }));
});
