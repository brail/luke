import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../components/ui/tooltip';
import PhaseCatalogPage from '../page';

/**
 * The page lists the whole catalog, retired phases included, through the read endpoint (ADR-049):
 * a reader sees it with every write action disabled. The phase dialog collects the catalog fields
 * of #158 — description, duration, colour — and sends them as the core schema wants them: text
 * trimmed, a whole number of days, a palette key; a field left blank goes as null, never as an
 * empty string.
 */

const PHASE = { description: null, durationDays: null, color: null };

const h = vi.hoisted(() => ({
  createMock: vi.fn(),
  listQuery: vi.fn(),
  canWrite: true,
  phases: [] as Array<Record<string, unknown>>,
  mutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
const { createMock } = h;
vi.mock('../../../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ phase: { list: { invalidate: vi.fn() } } }),
    phase: {
      list: {
        useQuery: (...args: unknown[]) => {
          h.listQuery(...args);
          return { data: h.phases, isLoading: false };
        },
      },
      create: { useMutation: () => ({ mutate: createMock, isPending: false }) },
      update: { useMutation: h.mutation },
      remove: { useMutation: h.mutation },
      restore: { useMutation: h.mutation },
    },
  },
}));
vi.mock('../../../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => h.canWrite }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  createMock.mockReset();
  h.listQuery.mockReset();
  h.canWrite = true;
  h.phases = [];
});

const renderPage = () => render(<TooltipProvider delayDuration={0}><PhaseCatalogPage /></TooltipProvider>);

async function openCreateDialog() {
  const screen = await renderPage();
  await screen.getByRole('button', { name: 'Aggiungi fase' }).click();
  await screen.getByLabelText('Valore (chiave)').fill('PROTO');
  await screen.getByLabelText('Label visualizzata').fill('Prototipo');
  return screen;
}

test('sends the description trimmed, the duration as a number and the chosen colour', async () => {
  const screen = await openCreateDialog();

  await screen.getByLabelText('Descrizione').fill('  Primo campione ');
  await screen.getByLabelText('Durata della fase (giorni)').fill('20');
  await screen.getByRole('radio', { name: 'Verde acqua' }).click();
  await screen.getByRole('button', { name: 'Aggiungi', exact: true }).click();

  await vi.waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
  expect(createMock).toHaveBeenCalledWith({
    value: 'PROTO', label: 'Prototipo', description: 'Primo campione', durationDays: 20, color: 'teal',
  });
});

test('sends a field left blank as null', async () => {
  const screen = await openCreateDialog();

  await screen.getByRole('button', { name: 'Aggiungi', exact: true }).click();

  await vi.waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
  expect(createMock).toHaveBeenCalledWith({
    value: 'PROTO', label: 'Prototipo', description: null, durationDays: null, color: null,
  });
});

test('refuses a duration that is not a whole number of days in range', async () => {
  const screen = await openCreateDialog();

  await screen.getByLabelText('Durata della fase (giorni)').fill('0');
  await screen.getByRole('button', { name: 'Aggiungi', exact: true }).click();

  await expect.element(screen.getByText('Un numero intero di giorni tra 1 e 365')).toBeVisible();
  expect(createMock).not.toHaveBeenCalled();
});

test('a reader sees the whole catalog, retired phases included, with every write action disabled', async () => {
  h.canWrite = false;
  h.phases = [
    { ...PHASE, id: 'p1', value: 'ACTIVE', label: 'Attiva', isActive: true },
    { ...PHASE, id: 'p2', value: 'RETIRED', label: 'Ritirata', isActive: false },
  ];

  const screen = await renderPage();

  expect(h.listQuery).toHaveBeenCalledWith({ includeInactive: true }, expect.anything());
  await expect.element(screen.getByText('ACTIVE')).toBeVisible();
  await expect.element(screen.getByText('RETIRED')).toBeVisible();
  await expect.element(screen.getByRole('button', { name: 'Aggiungi fase' })).toBeDisabled();
  const rowActions = [...screen.container.querySelectorAll('tbody button')];
  expect(rowActions).toHaveLength(3);
  for (const action of rowActions) expect(action).toBeDisabled();
});
