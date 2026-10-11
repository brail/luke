import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import CollectionControlPage from '../collection-control/page';

/**
 * An emptied "Da (gg)" used to be saved as 0 (`parseInt('') || 0`) and a decimal one truncated,
 * moving the band's start without asking. Both are now refused on save with a message.
 */

const h = vi.hoisted(() => ({ mutate: vi.fn(), toastError: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { error: h.toastError, success: vi.fn() } }));
vi.mock('../../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock('../../../../lib/trpc', () => {
  const thresholds = {
    default: { bands: [{ minDaysToDeadline: 5, maxDaysToDeadline: null, color: '#15803D', label: 'In tempo', emphasis: 'outline' }] },
    completedBand: { color: '#15803D', label: 'Concluso', emphasis: 'solid' },
    completedLateBand: { color: '#B91C1C', label: 'Concluso in ritardo', emphasis: 'solid' },
  };
  return {
    trpc: {
      useUtils: () => ({ phaseAlert: { thresholds: { invalidate: vi.fn() } } }),
      phaseAlert: {
        thresholds: { useQuery: () => ({ data: thresholds, isPending: false, error: null, refetch: vi.fn() }) },
        updateThresholds: { useMutation: () => ({ mutate: h.mutate, isPending: false }) },
      },
      phase: { list: { useQuery: () => ({ data: [] }) } },
    },
  };
});

beforeEach(() => {
  h.mutate.mockClear();
  h.toastError.mockClear();
});

// Emptied: `parseInt` made it 0. Decimal: `parseInt` truncated it, `valueAsNumber` keeps it for the schema.
test.each([['an emptied', ''], ['a decimal', '1.5']])('%s band start is refused with a message, not saved', async (_, typed) => {
  const screen = await render(<CollectionControlPage />);
  await screen.getByRole('spinbutton', { name: 'Da giorni' }).fill(typed);
  await screen.getByRole('button', { name: 'Salva Configurazione' }).click();

  expect(h.mutate).not.toHaveBeenCalled();
  expect(h.toastError).toHaveBeenCalledWith('Configurazione non valida', {
    description: 'I giorni di ogni fascia devono essere numeri interi',
  });
});
