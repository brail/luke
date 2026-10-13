import { toast } from 'sonner';
import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { HolidayImportTab } from '../HolidayImportTab';

/**
 * The preview fetches what the import would write, and is refused when the import would be: the
 * refusal is shown, not read as a year without holidays. The current year is the profile zone's,
 * and saved holidays are written as calendar days.
 */

const { refetchPreview, idleMutation, saved } = vi.hoisted(() => ({
  refetchPreview: vi.fn(),
  idleMutation: () => ({ mutate: () => undefined, isPending: false }),
  saved: { holidays: [] as unknown[] },
}));
const refused = { data: undefined, error: { data: { code: 'BAD_REQUEST' }, message: 'Nager.Date non risponde per DE (503)' } };
const listed = { data: [{ code: 'DE', name: 'Neujahr', nameEn: 'New Year', date: '2026-01-01' }], error: null };

vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    holidays: {
      listCountries: { useQuery: () => ({ data: [{ code: 'DE', name: 'Germania' }] }) },
      listHolidays: { useQuery: () => ({ data: saved.holidays, refetch: () => undefined }) },
      previewImport: { useQuery: () => ({ refetch: refetchPreview, isFetching: false }) },
      confirmImport: { useMutation: idleMutation },
      deleteHoliday: { useMutation: idleMutation },
    },
    me: { get: { useQuery: () => ({ data: { timezone: 'Asia/Shanghai' }, error: null }) } },
  },
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 't' }, status: 'authenticated' }) }));

afterEach(() => {
  vi.useRealTimers();
  saved.holidays = [];
});
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

test("the year on offer is the profile zone's, and saved holidays read as calendar days", async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // 21:00 on 31 December in Rome, already 1 January 2027 in Shanghai.
  vi.setSystemTime(new Date('2026-12-31T20:00:00Z'));
  saved.holidays = [{ id: 'h1', countryCode: 'IT', startDate: '2027-01-06T00:00:00.000Z', endDate: '2027-01-06T00:00:00.000Z', name: 'Epifania', nameEn: null }];
  const screen = await render(<HolidayImportTab />);

  await expect.element(screen.getByRole('button', { name: '2029' })).toBeVisible();
  expect(screen.getByRole('button', { name: '2025' }).elements()).toHaveLength(0);
  expect(screen.getByText('06/01/2027').elements()).toHaveLength(2);
});
