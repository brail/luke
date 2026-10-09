import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import AuditLogPage from '../page';

/**
 * The audit log shows each row in the profile's time zone, but the date filter read "from" as UTC
 * midnight and "to" as 23:59:59 in the browser's zone, so rows just after local midnight on the
 * first day fell out — in the list and in the export alike.
 */

const h = vi.hoisted(() => ({ listInput: vi.fn() }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: 'admin' }, accessToken: 't' } }),
}));
vi.mock('../../../../../lib/trpc', () => ({
  trpc: {
    // A zone far from any browser's: UTC+13 in October (daylight time).
    me: { get: { useQuery: () => ({ data: { timezone: 'Pacific/Auckland', locale: 'it-IT' } }) } },
    auditLog: {
      list: {
        useQuery: (input: unknown) => {
          h.listInput(input);
          return { data: undefined, isLoading: false };
        },
      },
      getExportLink: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
    users: { list: { useQuery: () => ({ data: undefined }) } },
  },
}));

test('the days picked are whole days in the profile time zone', async () => {
  const screen = await render(<AuditLogPage />);

  await screen.getByLabelText('Dal', { exact: true }).fill('2026-10-09');
  await screen.getByLabelText('Al', { exact: true }).fill('2026-10-09');

  expect(h.listInput).toHaveBeenLastCalledWith(
    expect.objectContaining({
      dateFrom: '2026-10-08T11:00:00.000Z',
      dateTo: '2026-10-09T10:59:59.999Z',
    })
  );
});
