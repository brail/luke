import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import type { MaintenanceModeState } from '@luke/core';

import { MaintenanceBanner } from '../MaintenanceBanner';

/**
 * During active maintenance the banner shows to whoever bypasses it (`maintenance:update`); its
 * "end" button calls `maintenance.mode.end`, which requires `maintenance:mode_manage`, so it shows
 * only with that permission. Today both are `admin`'s alone; the button no longer assumes so.
 */

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ maintenance: { mode: { getStatus: { invalidate: vi.fn() } } } }),
    maintenance: { mode: { end: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } } },
  },
}));

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
