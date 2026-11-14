import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { CollectionLayoutSummary } from '../CollectionLayoutSummary';

import type { ComponentProps } from 'react';

/**
 * The completed rows line counts rows, not SKU, and is independent of the phase (#181): it stays
 * hidden until a row is completed, and follows the rows the card receives. A retired phase that
 * still holds rows gets its own line after the active ones (#188).
 */

vi.mock('../../_hooks/useSeasonPhaseOrder', () => {
  const active = [{ id: 'design', label: 'Design' }, { id: 'proto', label: 'Prototipo' }];
  // Retired phases: the catalog still resolves them, the season order ranks them last.
  const retired = [{ id: 'sample', label: 'Campionatura' }, { id: 'archive', label: 'Archivio' }];
  return {
    useSeasonPhaseOrder: () => ({
      phases: active,
      phaseById: new Map([...active, ...retired].map(p => [p.id, p])),
      rank: (id: string) => { const i = active.findIndex(p => p.id === id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; },
    }),
  };
});

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

/** The phase lines, in card order: only the `Per Fase` card draws bars, one per line. */
async function phaseLines(screen: Awaited<ReturnType<typeof render>>) {
  await expect.element(screen.getByText('Per Fase')).toBeInTheDocument();
  return [...screen.container.querySelectorAll('[role="progressbar"]')].map(bar => bar.getAttribute('aria-label'));
}

test('a retired phase that holds rows gets its own marked line after the active ones', async () => {
  const rows = [
    { phaseId: 'design', skuForecast: 50 },
    { phaseId: 'sample', skuForecast: 30 },
    { phaseId: 'archive', skuForecast: 10 },
    { phaseId: 'gone', skuForecast: 5 },
    { phaseId: null, skuForecast: 5 },
  ].map((row, i) => ({ ...row, id: `r${i}`, qtyForecast: 100, vendor: null, completedAt: null }));
  // Partial fixture, as above.
  const withRetired = { id: 'l1', groups: [{ rows }] } as unknown as ComponentProps<typeof CollectionLayoutSummary>['layout'];

  const screen = await render(<CollectionLayoutSummary layout={withRetired} />);

  // Every row lands on a line, a phase the catalog does not know included.
  expect(await phaseLines(screen)).toEqual(['Design', 'Archivio (non attiva)', 'Campionatura (non attiva)', 'Fase sconosciuta', '—']);
  await expect.element(screen.getByText('1 righe · 30 SKU · 100 paia')).toBeInTheDocument();
  await expect.element(screen.getByRole('progressbar', { name: 'Campionatura (non attiva)' })).toHaveAttribute('aria-valuenow', '30');
});

test('a retired phase with no rows in the layout gets no line', async () => {
  const screen = await render(<CollectionLayoutSummary layout={layout([null, null, null])} />);

  expect(await phaseLines(screen)).toEqual(['Design', 'Prototipo']);
});
