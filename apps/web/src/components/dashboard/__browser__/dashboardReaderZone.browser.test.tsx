import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { DashboardHeader } from '../DashboardGrid';
import { WeeklySalesWidget } from '../widgets/WeeklySalesWidget';

/**
 * The dashboard reads today in the profile zone (ADR-035), whatever zone the browser runs in (Rome
 * locally, UTC in CI): the header's greeting, date and ISO week, and which weekly-sales bar — the
 * business zone's days — is "Oggi".
 */

const h = vi.hoisted(() => ({ zone: 'Asia/Shanghai' }));

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 't' }, status: 'authenticated' }) }));
vi.mock('../../../contexts/AppContextProvider', () => ({ useAppContext: () => ({ brand: { id: 'b' }, season: { id: 's' } }) }));
vi.mock('../../../lib/trpc', () => ({
  trpc: {
    me: { get: { useQuery: () => ({ data: { timezone: h.zone }, error: null }) } },
    dashboard: {
      getWeeklySales: {
        // The business zone's last seven days, ending on Sunday 4 January.
        useQuery: () => ({
          data: ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'].map(date => ({ date, count: 1 })),
          isLoading: false,
        }),
      },
    },
  },
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Sunday 4 January, 23:00 in Rome; already Monday 5 January, 06:00, in Shanghai.
  vi.setSystemTime(new Date('2026-01-04T22:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  h.zone = 'Asia/Shanghai';
});

test('today, its week and the greeting are read in the profile zone', async () => {
  const screen = await render(<DashboardHeader firstName="Luca" />);

  await expect.element(screen.getByRole('heading', { name: 'Buongiorno, Luca' })).toBeVisible();
  await expect.element(screen.getByText('lunedì 5 gennaio 2026 · Settimana 2')).toBeVisible();
});

test.each([
  ['Europe/Rome', 1],
  ['Asia/Shanghai', 0],
])("with the profile in %s, %i weekly-sales bar is today's", async (zone, count) => {
  h.zone = zone;
  const screen = await render(<WeeklySalesWidget />);

  await expect.element(screen.getByText('sab')).toBeVisible();
  expect(screen.getByText('Oggi').elements()).toHaveLength(count);
});
