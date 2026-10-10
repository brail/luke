import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import type { BackupScheduleConfig } from '@luke/core';

import { BackupScheduleCard } from '../BackupScheduleCard';

/**
 * The card edits the stored schedule, so it shows a form only for what was read: a failed read
 * offering an editable form would save placeholders over the real schedule. A time written through
 * the API on a minute the hour list does not offer still shows as stored.
 */

interface QueryState {
  data?: BackupScheduleConfig;
  isPending: boolean;
  error: unknown;
  refetch: () => void;
}

const query = vi.hoisted(() => {
  const current: QueryState = { isPending: true, error: null, refetch: () => {} };
  return { current };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ maintenance: { backup: { getScheduleConfig: { invalidate: vi.fn() } } } }),
    maintenance: {
      backup: {
        getScheduleConfig: { useQuery: () => query.current },
        updateScheduleConfig: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      },
    },
  },
}));

const stored: BackupScheduleConfig = {
  enabled: true, dailyTime: '22:00', scope: 'DB_AND_FILES', retentionDays: 14, retentionMinCount: 5, notifyOnFailure: true,
};

beforeEach(() => {
  query.current = { data: stored, isPending: false, error: null, refetch: vi.fn() };
});

test('a failed read shows the error and a retry, and no form to save', async () => {
  const refetch = vi.fn();
  query.current = { isPending: false, error: new Error('rete'), refetch };
  const screen = await render(<BackupScheduleCard />);

  await expect.element(screen.getByText('Impossibile caricare la pianificazione dei backup')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Salva Configurazione' }).elements()).toHaveLength(0);
  await screen.getByRole('button', { name: 'Riprova' }).click();
  expect(refetch).toHaveBeenCalledOnce();
});

test('the stored values fill the form, and follow them when they change', async () => {
  const screen = await render(<BackupScheduleCard />);
  await expect.element(screen.getByRole('combobox', { name: 'Orario giornaliero' })).toHaveTextContent('22:00');
  await expect.element(screen.getByRole('spinbutton', { name: 'Retention (giorni)' })).toHaveValue(14);

  query.current = { ...query.current, data: { ...stored, dailyTime: '04:00', retentionDays: 60 } };
  await screen.rerender(<BackupScheduleCard />);
  await expect.element(screen.getByRole('combobox', { name: 'Orario giornaliero' })).toHaveTextContent('04:00');
  await expect.element(screen.getByRole('spinbutton', { name: 'Retention (giorni)' })).toHaveValue(60);
});

test('a stored time off the hour list is shown as stored', async () => {
  query.current = { ...query.current, data: { ...stored, dailyTime: '02:30' } };
  const screen = await render(<BackupScheduleCard />);

  await expect.element(screen.getByRole('combobox', { name: 'Orario giornaliero' })).toHaveTextContent('02:30');
});
