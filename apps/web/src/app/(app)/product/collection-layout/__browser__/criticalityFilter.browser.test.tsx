import { expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../components/ui/tooltip';
import { CollectionLayoutTable } from '../_components/CollectionLayoutTable';

import type { ComponentProps } from 'react';

/**
 * The collection layout's criticality filter (#53): it offers the configured bands by name plus
 * `Senza criticità`, keeps the rows in any chosen band (or with no band, when that is chosen),
 * combines with the search, and stops drag-and-drop while it is on.
 */

vi.mock('../../../../../lib/trpc', () => {
  const band = (label: string, color: string) => ({ minDaysToDeadline: 0, maxDaysToDeadline: null, color, label, emphasis: 'outline' });
  // As for an event the user cannot list: the band stays, the tooltip needs no date.
  const criticality = (rowId: string, label: string) => ({ rowId, state: 'active', band: band(label, '#B91C1C'), daysToDeadline: 1, reached: false, deadlineDay: null, eventTitle: null });
  const answers: Record<string, unknown> = {
    'phaseAlert.thresholds': {
      default: { bands: [band('In ritardo', '#B91C1C'), band('Urgente', '#D97706'), band('In linea', '#15803D')] },
      completedBand: { label: 'Concluso', color: '#15803D', emphasis: 'solid' },
      completedLateBand: { label: 'Concluso in ritardo', color: '#B91C1C', emphasis: 'solid' },
    },
    // Delta has no criticality.
    'phaseAlert.criticalityForLayout': [criticality('a', 'In ritardo'), criticality('b', 'Urgente'), criticality('c', 'In linea')],
    'phase.list': [],
    'collectionCatalog.listAll': [],
  };
  const procedure = (path: string): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) => {
        if (key === 'useQuery') return () => ({ data: answers[path], isPending: false, isError: false });
        if (key === 'useMutation') return () => ({ mutate: vi.fn(), isPending: false });
        if (key === 'useUtils') return () => procedure('utils');
        return procedure(path ? `${path}.${String(key)}` : String(key));
      },
    });
  return { trpc: procedure('') };
});

const row = (id: string, line: string) => ({
  id, line, productCategory: 'BOOT', status: 'NEW', strategy: null, gender: 'MAN', article: null, designer: null,
  phaseId: null, pictureUrl: null, pricePositioning: null, skuForecast: 1, qtyForecast: 1, styleStatus: null, vendor: null, quotations: [],
});

type Props = ComponentProps<typeof CollectionLayoutTable>;

const layout = {
  id: 'layout-1',
  hiddenColumns: [],
  groups: [{
    id: 'group-1', name: 'Scarpe', collectionLayoutId: 'layout-1', skuBudget: null,
    rows: [row('a', 'Alpha'), row('b', 'Beta'), row('c', 'Gamma'), row('d', 'Delta')],
  }],
} as unknown as Props['layout']; // Only the fields the table reads; the rest of the router output is irrelevant here.

const noop = () => {};

const renderTable = () => render(
  <TooltipProvider>
    <CollectionLayoutTable
      layout={layout} canUpdate parameterSets={[]} onAddGroup={noop} onAddRow={noop} onEditRow={noop}
      onDuplicateRow={noop} onDeleteRow={noop} onRenameGroup={noop} onDeleteGroup={noop} onUpdateSettings={noop}
    />
  </TooltipProvider>
);

type Screen = Awaited<ReturnType<typeof renderTable>>;

/** The lines shown, in table order. */
async function lines(screen: Screen) {
  await expect.element(screen.getByText('Scarpe')).toBeInTheDocument();
  return [...screen.container.querySelectorAll('tbody tr')].map(tr => ['Alpha', 'Beta', 'Gamma', 'Delta'].find(l => tr.textContent?.includes(l)));
}

async function choose(screen: Screen, ...options: string[]) {
  await screen.getByRole('button', { name: /^Criticità/ }).click();
  for (const name of options) await screen.getByRole('menuitemcheckbox', { name }).click();
  await userEvent.keyboard('{Escape}');
}

test('offers the configured bands in order, the outcomes, then the rows with no band', async () => {
  const screen = await renderTable();
  await screen.getByRole('button', { name: /^Criticità/ }).click();

  expect(screen.getByRole('menuitemcheckbox').elements().map(e => e.textContent))
    .toEqual(['In ritardo', 'Urgente', 'In linea', 'Concluso', 'Concluso in ritardo', 'Senza criticità']);
});

test('keeps the rows in any chosen band, and stops drag-and-drop', async () => {
  const screen = await renderTable();
  expect(screen.container.querySelectorAll('tbody .cursor-grab').length).toBe(4);

  await choose(screen, 'In ritardo', 'Urgente');

  expect(await lines(screen)).toEqual(['Alpha', 'Beta']);
  await expect.element(screen.getByRole('button', { name: 'Criticità (2)' })).toBeVisible();
  expect(screen.container.querySelectorAll('tbody .cursor-grab').length).toBe(0);
});

test('keeps the rows with no band when that is chosen', async () => {
  const screen = await renderTable();

  await choose(screen, 'Senza criticità');

  expect(await lines(screen)).toEqual(['Delta']);
});

test('combines with the search, and the reset clears both', async () => {
  const screen = await renderTable();

  await choose(screen, 'In ritardo', 'Urgente');
  await screen.getByPlaceholder('Cerca linea o fornitore…').fill('Beta');
  expect(await lines(screen)).toEqual(['Beta']);

  await screen.getByRole('button', { name: 'Reset' }).click();
  expect(await lines(screen)).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta']);
});
