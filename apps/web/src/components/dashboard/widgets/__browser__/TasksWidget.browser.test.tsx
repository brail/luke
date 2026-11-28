import { act } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { addCalendarDays, calendarDateIn, utcMidnightOf } from '@luke/core';

import { idempotencyKeyOf } from '../../../../lib/idempotencyKey';
import { TasksWidget } from '../TasksWidget';

/**
 * A task's due day is a calendar day, compared with today in the profile zone, not the browser's
 * (ADR-035). The two profile zones are 25 hours apart (UTC+14 and UTC−11), so their dates always
 * differ: a "today" taken in the browser's zone, whatever it is, fails one of them.
 */

const { meQuery, tasksQuery, upsert } = vi.hoisted(() => ({
  meQuery: { data: undefined as { timezone: string } | undefined, error: null },
  tasksQuery: { data: [] as { id: string; label: string; done: boolean; dueDate: string | null }[], isLoading: false },
  upsert: {
    mutate: vi.fn(),
    /** Each render's `upsertTask.useMutation` options. */
    options: [] as Array<{ onSuccess?: (task: unknown, variables: { id?: string; label: string }) => void }>,
  },
}));

vi.mock('../../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ dashboard: { getTasks: { invalidate: () => undefined } } }),
    me: { get: { useQuery: () => meQuery } },
    dashboard: {
      getTasks: { useQuery: () => tasksQuery },
      upsertTask: {
        useMutation: (options: { onSuccess?: (task: unknown, variables: { id?: string; label: string }) => void }) => {
          upsert.options.push(options);
          // One spy for both paths: creates go through `mutateAsync` (the action hook), ticks `mutate`.
          return { mutate: upsert.mutate, mutateAsync: upsert.mutate, isPending: false };
        },
      },
      deleteTask: { useMutation: () => ({ mutate: () => undefined, isPending: false }) },
    },
  },
}));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 't' }, status: 'authenticated' }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  meQuery.data = undefined;
  upsert.mutate.mockReset();
  upsert.options.length = 0;
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

/** Creating a task carries its action's key (#248); ticking one by id, meanwhile, carries none. */
test('a create and a tick sent together never share a key; a failed create keeps its text', async () => {
  tasksQuery.data = [{ id: 't1', label: 'Esistente', done: false, dueDate: null }];
  upsert.mutate.mockReturnValue(new Promise(() => undefined)); // no answer arrives
  const screen = await render(<TasksWidget />);

  await screen.getByPlaceholder('Nuova attività...').fill('Nuova');
  await screen.getByRole('button').first().click();
  await screen.getByRole('checkbox').click();

  const [created, ticked] = upsert.mutate.mock.calls.map(call => call[0]);
  expect(created).toEqual({ label: 'Nuova' });
  expect(idempotencyKeyOf(created)).toBeDefined();
  expect(ticked).toEqual({ id: 't1', label: 'Esistente', done: true });
  expect(idempotencyKeyOf(ticked)).toBeUndefined();
  // No answer yet, or a failed one: the text stays for the retry, which resends the same request.
  await expect.element(screen.getByPlaceholder('Nuova attività...')).toHaveValue('Nuova');
  await screen.getByRole('button').first().click();
  expect(upsert.mutate.mock.calls[2]?.[0]).toBe(created);
});

test('a confirmed create clears the text, and the same text again is a new action', async () => {
  upsert.mutate.mockResolvedValue({ id: 't9' });
  const screen = await render(<TasksWidget />);
  const input = screen.getByPlaceholder('Nuova attività...');

  await input.fill('Nuova');
  await screen.getByRole('button').first().click();
  const first = upsert.mutate.mock.calls[0]?.[0] as { label: string };
  upsert.options.at(-1)?.onSuccess?.({ id: 't9' }, first);
  await expect.element(input).toHaveValue('');

  await input.fill('Nuova');
  await screen.getByRole('button').first().click();
  const second = upsert.mutate.mock.calls[1]?.[0] as object;
  expect(second).not.toBe(first);
  expect(idempotencyKeyOf(second)).not.toBe(idempotencyKeyOf(first));
});

test('text typed while a create is pending is a new task and survives its success', async () => {
  const screen = await render(<TasksWidget />);
  const input = screen.getByPlaceholder('Nuova attività...');

  await input.fill('Prima');
  await screen.getByRole('button').first().click();
  await input.fill('Seconda');
  await act(async () => upsert.options.at(-1)?.onSuccess?.({ id: 't9' }, { label: 'Prima' }));

  await expect.element(input).toHaveValue('Seconda');
});
