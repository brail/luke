import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../components/ui/tooltip';
import PhaseCatalogPage from '../page';

/**
 * The phase dialog collects the catalog fields of #158 — description, duration, colour — and sends
 * them as the core schema wants them: text trimmed, a whole number of days, a palette key; a field
 * left blank goes as null, never as an empty string.
 */

const { createMock, mutation } = vi.hoisted(() => ({
  createMock: vi.fn(),
  mutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../../../../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ phase: { listAll: { invalidate: vi.fn() }, list: { invalidate: vi.fn() } } }),
    phase: {
      listAll: { useQuery: () => ({ data: [], isLoading: false }) },
      create: { useMutation: () => ({ mutate: createMock, isPending: false }) },
      update: { useMutation: mutation },
      remove: { useMutation: mutation },
      restore: { useMutation: mutation },
    },
  },
}));
vi.mock('../../../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => createMock.mockReset());

async function openCreateDialog() {
  const screen = await render(<TooltipProvider delayDuration={0}><PhaseCatalogPage /></TooltipProvider>);
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
