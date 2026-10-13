import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { formatInstant, type MaintenanceModeState } from '@luke/core';

import { MaintenanceBanner } from '../MaintenanceBanner';

/**
 * During active maintenance the banner shows to whoever bypasses it (`maintenance:update`); its
 * "end" button calls `maintenance.mode.end`, which requires `maintenance:mode_manage`, so it shows
 * only with that permission. Today both are `admin`'s alone; the button no longer assumes so.
 *
 * A scheduled window is dated in the profile zone; on the sign-in page, without a session, in the
 * browser zone, named (ADR-035).
 */

const { meQuery, meGet, session } = vi.hoisted(() => {
  const meQuery = { data: undefined as { timezone: string } | undefined, error: null };
  return { meQuery, meGet: vi.fn(() => meQuery), session: { status: 'authenticated' as 'authenticated' | 'unauthenticated' } };
});

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ maintenance: { mode: { getStatus: { invalidate: vi.fn() } } } }),
    maintenance: { mode: { end: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } } },
    me: { get: { useQuery: meGet } },
  },
}));
vi.mock('next-auth/react', () => ({
  useSession: () => (session.status === 'authenticated' ? { data: { accessToken: 't' }, status: 'authenticated' } : { data: null, status: 'unauthenticated' }),
}));

afterEach(() => {
  meQuery.data = undefined;
  session.status = 'authenticated';
  meGet.mockClear();
});

const active: MaintenanceModeState = {
  status: 'ACTIVE',
  scheduledAt: null,
  activatedAt: '2026-10-04T10:00:00.000Z',
  message: null,
  forceLogout: false,
  warningLeadMinutes: [],
  warningsSent: [],
  activatedByUserId: null,
  notifyByEmail: false,
};

test.each([
  [true, 1],
  [false, 0],
])('with maintenance:mode_manage %s, the end button shows %i time(s)', async (canEnd, count) => {
  const screen = await render(<MaintenanceBanner state={active} isAdmin canEnd={canEnd} msRemaining={null} />);

  await expect.element(screen.getByText(/Modalità manutenzione attiva/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Termina manutenzione' }).elements()).toHaveLength(count);
});

const AT = '2026-11-02T09:00:00.000Z';
const scheduled: MaintenanceModeState = { ...active, status: 'SCHEDULED', scheduledAt: AT, activatedAt: null };
const threeDays = 3 * 24 * 60 * 60_000;

test('a window days away is dated in the profile zone', async () => {
  meQuery.data = { timezone: 'America/Los_Angeles' };
  const screen = await render(<MaintenanceBanner state={scheduled} isAdmin={false} canEnd={false} msRemaining={threeDays} />);

  // 09:00 UTC: 10:00 in Rome, 01:00 in Los Angeles.
  await expect.element(screen.getByText('Manutenzione programmata — 2 nov 2026, 01:00')).toBeVisible();
});

test('without a session the window is dated in the browser zone, which it names', async () => {
  session.status = 'unauthenticated';
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const screen = await render(<MaintenanceBanner state={scheduled} isAdmin={false} canEnd={false} msRemaining={threeDays} />);

  const at = formatInstant(new Date(AT), zone, { dateStyle: 'medium', timeStyle: 'short' }, 'it-IT');
  await expect.element(screen.getByText(`Manutenzione programmata — ${at} (${zone})`)).toBeVisible();
});

test('during active maintenance the banner never asks for the profile zone', async () => {
  // `me.get` is refused to whoever does not bypass maintenance: its error toast would cover the lock screen.
  await render(<MaintenanceBanner state={active} isAdmin={false} canEnd={false} msRemaining={null} />);

  expect(meGet).not.toHaveBeenCalled();
});
