import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import type { BackupScheduleConfig, BackupScheduleSettings } from '@luke/core';

import { BackupScheduleCard } from '../BackupScheduleCard';

/**
 * The card edits the stored schedule, so it shows a form only for what was read: a failed read
 * offering an editable form would save placeholders over the real schedule. A time written through
 * the API on a minute the hour list does not offer still shows as stored.
 */

interface QueryState {
  data?: BackupScheduleSettings;
  isPending: boolean;
  error: unknown;
  refetch: () => void;
}

const query = vi.hoisted(() => {
  const current: QueryState = { isPending: true, error: null, refetch: () => {} };
  return { current, mutate: vi.fn() };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ maintenance: { backup: { getScheduleConfig: { invalidate: vi.fn() } } } }),
    maintenance: {
      backup: {
        getScheduleConfig: { useQuery: () => query.current },
        updateScheduleConfig: { useMutation: () => ({ mutate: query.mutate, isPending: false }) },
      },
    },
  },
}));

const stored: BackupScheduleConfig = {
  enabled: true, dailyTime: '22:00', scope: 'DB_AND_FILES', retentionDays: 14, retentionMinCount: 5, notifyOnFailure: true,
};

beforeEach(() => {
  query.current = { data: stored, isPending: false, error: null, refetch: vi.fn() };
  query.mutate.mockClear();
});

test('an emptied retention field is refused with a message, not saved as 0', async () => {
  // `parseInt('') || 0` saved 0: no backup kept back from pruning.
  const screen = await render(<BackupScheduleCard />);
  await screen.getByRole('spinbutton', { name: 'Minimo da conservare' }).clear();
  await screen.getByRole('button', { name: 'Salva Configurazione' }).click();

  await expect.element(screen.getByText('Inserisci un numero tra 0 e 1000')).toBeVisible();
  expect(query.mutate).not.toHaveBeenCalled();
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

test('an invalid stored scope is shown and must be chosen before saving', async () => {
  // It used to read as `DB`, and saving made the silent fallback permanent.
  query.current = { ...query.current, data: { ...stored, scope: null, storedScope: 'EVERYTHING' } };
  const screen = await render(<BackupScheduleCard />);

  await expect.element(screen.getByText('Contenuto salvato non valido')).toBeVisible();
  await expect.element(screen.getByText(/«EVERYTHING»/)).toBeVisible();
  await screen.getByRole('button', { name: 'Salva Configurazione' }).click();
  await expect.element(screen.getByText('Scegli il contenuto del backup')).toBeVisible();
  expect(query.mutate).not.toHaveBeenCalled();

  await screen.getByRole('combobox', { name: 'Contenuto' }).click();
  await screen.getByRole('option', { name: 'DB + file' }).click();
  await screen.getByRole('button', { name: 'Salva Configurazione' }).click();
  await expect.poll(() => query.mutate.mock.calls[0]?.[0]).toEqual({ ...stored, scope: 'DB_AND_FILES' });
});

test('a stored time off the hour list is shown as stored', async () => {
  query.current = { ...query.current, data: { ...stored, dailyTime: '02:30' } };
  const screen = await render(<BackupScheduleCard />);

  await expect.element(screen.getByRole('combobox', { name: 'Orario giornaliero' })).toHaveTextContent('02:30');
});
