import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { BusinessTimeZoneCard } from '../company/_components/BusinessTimeZoneCard';
import { ProfileTab } from '../company/_components/ProfileTab';
import NavSyncPage from '../nav-sync/page';

/**
 * These forms keep what they read in local state and save all of it: after a failed read they
 * offered their placeholders, and saving turned the automatic NAV sync off, emptied a selection or
 * blanked the company profile. They now show the error and a retry until the stored values are read.
 */

interface QueryState {
  data?: unknown;
  isPending: boolean;
  isSuccess: boolean;
  error: unknown;
  refetch: () => void;
}

const h = vi.hoisted(() => {
  const state: Record<'filter' | 'profile' | 'zone', QueryState> = {
    filter: { isPending: true, isSuccess: false, error: null, refetch: () => {} },
    profile: { isPending: true, isSuccess: false, error: null, refetch: () => {} },
    zone: { isPending: true, isSuccess: false, error: null, refetch: () => {} },
  };
  return { state, getFilter: vi.fn((_input: { entity: string }) => state.filter), saveSchedule: vi.fn() };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock('../../../../hooks/useStorageUpload', () => ({
  useStorageUpload: () => ({ upload: vi.fn(), isUploading: false, progress: 0 }),
}));
vi.mock('../../../../lib/trpc', () => {
  const mutation = { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false }) };
  const syncState = { useQuery: () => ({ data: { isRunning: false, tables: [] }, refetch: vi.fn() }) };
  const utils = { company: { profile: { get: { invalidate: vi.fn() } } }, config: { getMultiple: { invalidate: vi.fn() } } };
  return {
    trpc: {
      useUtils: () => utils,
      sales: {
        statistics: {
          portafoglio: { getSyncState: syncState, triggerSync: mutation },
          kimo: { getSyncState: syncState, triggerSync: mutation },
        },
      },
      integrations: {
        nav: {
          sync: {
            getFilter: { useQuery: h.getFilter },
            preview: { useQuery: () => ({ isFetching: false, isLoading: false, isError: false, refetch: vi.fn() }) },
            saveFilter: mutation,
            saveSyncSchedule: { useMutation: () => ({ mutate: h.saveSchedule, isPending: false }) },
            run: mutation,
          },
        },
      },
      company: { profile: { get: { useQuery: () => h.state.profile }, update: mutation } },
      config: { getMultiple: { useQuery: () => h.state.zone }, set: mutation },
    },
  };
});

const failed = (refetch = vi.fn()): QueryState => ({ isPending: false, isSuccess: false, error: new Error('rete'), refetch });
const read = (data: unknown): QueryState => ({ data, isPending: false, isSuccess: true, error: null, refetch: vi.fn() });

beforeEach(() => {
  h.getFilter.mockClear();
  h.saveSchedule.mockClear();
  h.state.filter = read({ entity: 'x', mode: 'all', navNos: [], autoSyncEnabled: true, intervalMinutes: 15, updatedAt: new Date() });
  h.state.profile = read({ legalName: 'Febos S.r.l.', displayName: 'Febos', updatedAt: new Date() });
  h.state.zone = read([{ key: 'app.defaultTimezone', value: 'Asia/Shanghai', found: true }]);
});

const NAV_TABS = ['Fornitori', 'Portafoglio Vendite', 'KIMO-FASHION'];

test.each(NAV_TABS)('NAV sync "%s": a failed read shows the error and a retry, and no form to save', async tab => {
  const refetch = vi.fn();
  h.state.filter = failed(refetch);
  const screen = await render(<NavSyncPage />);
  await screen.getByRole('tab', { name: tab }).click();

  await expect.element(screen.getByText('Errore nel caricamento')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Salva configurazione' }).elements()).toHaveLength(0);
  await screen.getByRole('button', { name: 'Riprova' }).click();
  expect(refetch).toHaveBeenCalledOnce();
});

test.each(NAV_TABS)('NAV sync "%s": the stored schedule fills the form', async tab => {
  const screen = await render(<NavSyncPage />);
  await screen.getByRole('tab', { name: tab }).click();

  await expect.element(screen.getByText('Ogni 15 min')).toBeVisible();
  await expect.element(screen.getByRole('button', { name: 'Salva configurazione' })).toBeVisible();
});

test.each(NAV_TABS)('NAV sync "%s": a filter never configured still shows the form', async tab => {
  h.state.filter = read(null);
  const screen = await render(<NavSyncPage />);
  await screen.getByRole('tab', { name: tab }).click();

  await expect.element(screen.getByRole('button', { name: 'Salva configurazione' })).toBeVisible();
});

test.each(NAV_TABS)('NAV sync "%s": an edit survives a failed refetch that recovers', async tab => {
  const screen = await render(<NavSyncPage />);
  await screen.getByRole('tab', { name: tab }).click();
  await screen.getByRole('switch').click();
  await expect.element(screen.getByText('Solo manuale')).toBeVisible();

  // The failed refetch keeps the data, and structural sharing returns the same reference on recovery.
  const { data } = h.state.filter;
  h.state.filter = { ...failed(), data };
  await screen.rerender(<NavSyncPage />);
  h.state.filter = read(data);
  await screen.rerender(<NavSyncPage />);

  await expect.element(screen.getByText('Solo manuale')).toBeVisible();
});

test.each([
  ['Portafoglio Vendite', 'portafoglio'],
  ['KIMO-FASHION', 'kimo'],
])('NAV sync "%s" reads and saves its own schedule', async (tab, entity) => {
  const screen = await render(<NavSyncPage />);
  await screen.getByRole('tab', { name: tab }).click();
  await screen.getByRole('button', { name: 'Salva configurazione' }).click();

  expect(h.getFilter).toHaveBeenCalledWith({ entity });
  expect(h.saveSchedule).toHaveBeenCalledWith({ entity, autoSyncEnabled: true, intervalMinutes: 15 });
});

test('company profile: a failed read shows the error and a retry, and no form to save', async () => {
  const refetch = vi.fn();
  h.state.profile = failed(refetch);
  const screen = await render(<ProfileTab />);

  await expect.element(screen.getByText('Errore nel caricamento')).toBeVisible();
  expect(screen.getByLabelText('Ragione sociale *').elements()).toHaveLength(0);
  await screen.getByRole('button', { name: 'Riprova' }).click();
  expect(refetch).toHaveBeenCalledOnce();
});

test('company profile: the stored profile fills the form', async () => {
  const screen = await render(<ProfileTab />);

  await expect.element(screen.getByLabelText('Ragione sociale *')).toHaveValue('Febos S.r.l.');
});

test('business time zone: a failed read shows the error, not the default as if it were stored', async () => {
  h.state.zone = failed();
  const screen = await render(<BusinessTimeZoneCard />);

  await expect.element(screen.getByText('Errore nel caricamento')).toBeVisible();
  expect(screen.getByRole('combobox', { name: 'Fuso orario' }).elements()).toHaveLength(0);
});

test('business time zone: the stored zone is selected', async () => {
  const screen = await render(<BusinessTimeZoneCard />);

  await expect.element(screen.getByRole('combobox', { name: 'Fuso orario' })).toHaveTextContent('Asia/Shanghai (CST)');
});
