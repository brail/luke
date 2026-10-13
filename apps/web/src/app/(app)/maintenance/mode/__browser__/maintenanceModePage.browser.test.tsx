import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import type { MaintenanceModeState } from '@luke/core';

import MaintenanceModePage from '../page';

/**
 * A maintenance window is typed and read in the profile zone, not the browser's (ADR-035): the field
 * names the zone, and what is typed is converted with the zone the form had when it opened.
 * The browser runs in another zone than the profile's Los Angeles (Rome locally, UTC in CI).
 */

const h = vi.hoisted(() => {
  const state: Partial<MaintenanceModeState> = {};
  return { state, me: { data: { timezone: 'America/Los_Angeles' }, error: null }, schedule: vi.fn() };
});

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 't' }, status: 'authenticated' }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../../../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock('../../../../../lib/trpc', () => {
  const mutation = { useMutation: () => ({ mutate: vi.fn(), isPending: false }) };
  return {
    trpc: {
      useUtils: () => ({ maintenance: { mode: { getStatus: { invalidate: vi.fn() } } } }),
      me: { get: { useQuery: () => h.me } },
      maintenance: {
        mode: {
          getStatus: { useQuery: () => ({ data: h.state, isLoading: false }) },
          schedule: { useMutation: () => ({ mutate: h.schedule, isPending: false }) },
          activateNow: mutation,
          cancelScheduled: mutation,
          end: mutation,
        },
      },
    },
  };
});

beforeEach(() => {
  h.state = { status: 'INACTIVE', scheduledAt: null, activatedAt: null, message: null };
  h.me.data.timezone = 'America/Los_Angeles';
  h.schedule.mockClear();
});

test('a window typed on the page is a wall time of the profile zone, which the field names', async () => {
  const screen = await render(<MaintenanceModePage />);

  await screen.getByLabelText('Data e ora di inizio (orari in America/Los_Angeles)').fill('2030-01-15T01:00');
  await screen.getByRole('button', { name: 'Pianifica' }).click();

  // 01:00 in Los Angeles is 09:00 UTC.
  expect(h.schedule).toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: '2030-01-15T09:00:00.000Z' }));
});

test('a profile change while the form is open does not reinterpret what is typed', async () => {
  const screen = await render(<MaintenanceModePage />);
  await screen.getByLabelText(/Data e ora di inizio/).fill('2030-01-15T01:00');

  // As when the time zone dialog moves the profile to the browser's zone.
  h.me.data.timezone = 'Europe/Rome';
  await screen.rerender(<MaintenanceModePage />);
  await screen.getByLabelText('Data e ora di inizio (orari in America/Los_Angeles)').fill('2030-01-15T01:30');
  await screen.getByRole('button', { name: 'Pianifica' }).click();

  expect(h.schedule).toHaveBeenCalledWith(expect.objectContaining({ scheduledAt: '2030-01-15T09:30:00.000Z' }));
});

test('a scheduled window is shown in the profile zone', async () => {
  h.state = { status: 'SCHEDULED', scheduledAt: '2030-01-15T09:00:00.000Z', activatedAt: null, message: null };
  const screen = await render(<MaintenanceModePage />);

  await expect.element(screen.getByText('Prevista per 15 gen 2030, 01:00')).toBeVisible();
});
