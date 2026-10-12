import { toast } from 'sonner';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { HolidayImportTab } from '../HolidayImportTab';

/**
 * The preview fetches what the import would write, and is refused when the import would be: the
 * refusal is shown, not read as a year without holidays.
 */

const { refetchPreview, idleMutation } = vi.hoisted(() => ({
  refetchPreview: vi.fn(),
  idleMutation: () => ({ mutate: () => undefined, isPending: false }),
}));
const refused = { data: undefined, error: { data: { code: 'BAD_REQUEST' }, message: 'Nager.Date non risponde per DE (503)' } };
const listed = { data: [{ code: 'DE', name: 'Neujahr', nameEn: 'New Year', date: '2026-01-01' }], error: null };

vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    holidays: {
      listCountries: { useQuery: () => ({ data: [{ code: 'DE', name: 'Germania' }] }) },
      listHolidays: { useQuery: () => ({ data: [], refetch: () => undefined }) },
      previewImport: { useQuery: () => ({ refetch: refetchPreview, isFetching: false }) },
      confirmImport: { useMutation: idleMutation },
      deleteHoliday: { useMutation: idleMutation },
    },
  },
}));
vi.mock('../../../../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

test('a refused preview shows why, and offers no import — not even the one previewed before', async () => {
  refetchPreview.mockResolvedValueOnce(listed).mockResolvedValueOnce(refused);
  const screen = await render(<HolidayImportTab />);

  await screen.getByRole('checkbox').click();
  await screen.getByRole('button', { name: 'Anteprima' }).click();
  await expect.element(screen.getByRole('button', { name: /Importa/ })).toBeInTheDocument();

  await screen.getByRole('button', { name: 'Anteprima' }).click();
  await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Nager.Date non risponde per DE (503)'));
  expect(screen.getByRole('button', { name: /Importa/ }).query()).toBeNull();
});
