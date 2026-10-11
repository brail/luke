import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { addCalendarDays, calendarDateIn, utcMidnightOf } from '@luke/core';

import { TasksWidget } from '../TasksWidget';

/**
 * A task's due day is a calendar day, compared with today in the profile zone, not the browser's
 * (ADR-035). The two profile zones are 25 hours apart (UTC+14 and UTC−11), so their dates always
 * differ: a "today" taken in the browser's zone, whatever it is, fails one of them.
 */

const { meQuery, tasksQuery } = vi.hoisted(() => ({
  meQuery: { data: undefined as { timezone: string } | undefined, error: null },
  tasksQuery: { data: [] as { id: string; label: string; done: boolean; dueDate: string | null }[], isLoading: false },
}));

vi.mock('../../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ dashboard: { getTasks: { invalidate: () => undefined } } }),
    me: { get: { useQuery: () => meQuery } },
    dashboard: {
      getTasks: { useQuery: () => tasksQuery },
      upsertTask: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
      deleteTask: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
    },
  },
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 't' }, status: 'authenticated' }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  meQuery.data = undefined;
});

/** Tasks due today and yesterday in `timeZone`, stored as the API stores a day: its UTC midnight. */
function tasksAround(timeZone: string) {
  const today = calendarDateIn(new Date(), timeZone);
  tasksQuery.data = [
    { id: 't1', label: 'Oggi', done: false, dueDate: utcMidnightOf(today).toISOString() },
    { id: 't2', label: 'Ieri', done: false, dueDate: utcMidnightOf(addCalendarDays(today, -1)).toISOString() },
  ];
}

test('no due badge before the profile zone has loaded', async () => {
  tasksAround(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const screen = await render(<TasksWidget />);

  await expect.element(screen.getByText('Ieri')).toBeInTheDocument();
  expect(screen.getByText('oggi', { exact: true }).elements()).toHaveLength(0);
  expect(screen.getByText('scaduto', { exact: true }).elements()).toHaveLength(0);
});

test.each(['Pacific/Kiritimati', 'Pacific/Pago_Pago'])('marks the days in the profile zone %s', async timezone => {
  meQuery.data = { timezone };
  tasksAround(timezone);
  const screen = await render(<TasksWidget />);

  await expect.element(screen.getByText('oggi', { exact: true })).toBeInTheDocument();
  await expect.element(screen.getByText('scaduto', { exact: true })).toBeInTheDocument();
});
