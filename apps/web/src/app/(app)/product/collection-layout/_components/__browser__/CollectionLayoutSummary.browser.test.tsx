import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { CollectionLayoutSummary } from '../CollectionLayoutSummary';

import type { ComponentProps } from 'react';

/**
 * The completed rows line counts rows, not SKU, and is independent of the phase (#181): it stays
 * hidden until a row is completed, and follows the rows the card receives.
 */

vi.mock('../../_hooks/useSeasonPhaseOrder', () => ({
  useSeasonPhaseOrder: () => ({ phases: [{ id: 'design', label: 'Design' }, { id: 'proto', label: 'Prototipo' }] }),
}));

const LINE = 'Righe concluse';

// Uneven SKU across two phases: a share of SKU, or a count within one phase, gives another number.
const FIXTURE = [
  { phaseId: 'design', skuForecast: 10 },
  { phaseId: 'proto', skuForecast: 10 },
  { phaseId: 'design', skuForecast: 80 },
];

function layout(completedAt: (Date | null)[]) {
  const rows = FIXTURE.map((row, i) => ({
    ...row,
    id: `r${i}`,
    qtyForecast: 100,
    vendor: null,
    completedAt: completedAt[i],
  }));
  // Partial fixture: the card reads only these row fields, not the whole `collectionLayout.get` output.
  return { id: 'l1', groups: [{ rows }] } as unknown as ComponentProps<typeof CollectionLayoutSummary>['layout'];
}

test('hides the line while no row is completed', async () => {
  const screen = await render(<CollectionLayoutSummary layout={layout([null, null, null])} />);

  await expect.element(screen.getByText('Design')).toBeInTheDocument();
  await expect.element(screen.getByText(LINE)).not.toBeInTheDocument();
});

test('shows completed rows out of all rows, with a matching bar, and follows a reopened row', async () => {
  const done = new Date('2026-10-31T10:00:00Z');
  const screen = await render(<CollectionLayoutSummary layout={layout([done, done, null])} />);

  await expect.element(screen.getByText('2 di 3 righe')).toBeInTheDocument();
  await expect.element(screen.getByText('67%')).toBeInTheDocument();
  await expect.element(screen.getByRole('progressbar', { name: LINE })).toHaveAttribute('aria-valuenow', '67');

  await screen.rerender(<CollectionLayoutSummary layout={layout([done, null, null])} />);

  await expect.element(screen.getByText('1 di 3 righe')).toBeInTheDocument();
  await expect.element(screen.getByText('33%')).toBeInTheDocument();
  await expect.element(screen.getByRole('progressbar', { name: LINE })).toHaveAttribute('aria-valuenow', '33');

  await screen.rerender(<CollectionLayoutSummary layout={layout([null, null, null])} />);

  await expect.element(screen.getByText(LINE)).not.toBeInTheDocument();
});
