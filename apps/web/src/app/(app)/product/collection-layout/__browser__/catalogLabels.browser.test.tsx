import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../components/ui/tooltip';
import { CollectionGroupSection } from '../_components/CollectionGroupSection';

import type { ComponentProps } from 'react';

/**
 * The table shows every catalog-backed cell under its item's label (#245): a label renamed in the
 * catalog, a deactivated item's label, and a value no item has as itself; a column sorts by the
 * label it shows, not the stored value.
 */

vi.mock('../../../../../lib/trpc', () => {
  const item = (type: string, value: string, label: string, isActive = true) => ({ type, value, label, isActive });
  const answers: Record<string, unknown> = {
    'collectionCatalog.listAll': [
      item('productCategory', 'BOOT', 'Stivale', false),
      item('productCategory', 'ANKLE', 'Tronchetto'),
      item('lineStatus', 'NEW', 'Nuovo'),
      item('strategy', 'CORE', 'Core'),
    ],
    'phase.list': [],
    'phaseAlert.criticalityForLayout': [],
  };
  const procedure = (path: string): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) => {
        if (key === 'useQuery') return () => ({ data: answers[path], isPending: false, isError: false });
        if (key === 'useMutation') return () => ({ mutate: vi.fn(), isPending: false });
        return procedure(path ? `${path}.${String(key)}` : String(key));
      },
    });
  return { trpc: procedure('') };
});

const row = (id: string, line: string, productCategory: string, status: string, strategy: string | null) => ({
  id, line, productCategory, status, strategy,
  gender: 'MAN', article: null, designer: null, phaseId: null, pictureUrl: null, pricePositioning: null,
  skuForecast: 1, qtyForecast: 1, styleStatus: null, vendor: null, quotations: [],
});

type Props = ComponentProps<typeof CollectionGroupSection>;

const group = {
  id: 'group-1',
  name: 'Scarpe',
  collectionLayoutId: 'layout-1',
  skuBudget: null,
  rows: [row('row-2', 'Beta', 'ANKLE', 'NEW', 'CORE'), row('row-1', 'Alpha', 'BOOT', 'NEW', 'INNOVATION')],
} as unknown as Props['group']; // Only the fields the table reads; the rest of the router output is irrelevant here.

const noop = () => {};

const renderTable = () => render(
  <TooltipProvider>
    <CollectionGroupSection
      group={group} canUpdate hiddenColumns={[]} parameterSets={[]} selectedRowIds={new Set()}
      onAddRow={noop} onEditRow={noop} onDuplicateRow={noop} onDeleteRow={noop} onRenameGroup={noop}
      onDeleteGroup={noop} onToggleRowSelection={noop} onSelectAllRows={noop}
    />
  </TooltipProvider>
);

/** The body rows' text, in table order; dnd-kit gives each row `role="button"`, so they are read from the DOM. */
async function bodyRows(screen: Awaited<ReturnType<typeof renderTable>>) {
  await expect.element(screen.getByText('Alpha')).toBeInTheDocument();
  return [...screen.container.querySelectorAll('tbody tr')].map(tr => tr.textContent ?? '');
}

const lines = (rows: string[]) => rows.map(text => (text.includes('Alpha') ? 'Alpha' : 'Beta'));

test('shows the label of a renamed, a deactivated and an active item, and a value no item has as itself', async () => {
  const [beta, alpha] = await bodyRows(await renderTable());

  for (const text of ['Stivale', 'Nuovo', 'INNOVATION']) expect(alpha).toContain(text);
  expect(alpha).not.toContain('BOOT');
  expect(beta).toContain('Tronchetto');
});

test('sorts a catalog column by the label it shows', async () => {
  const screen = await renderTable();

  expect(lines(await bodyRows(screen))).toEqual(['Beta', 'Alpha']);
  await screen.getByRole('button', { name: 'Categoria' }).click();

  // By value ANKLE (Beta) would sort first; by label Stivale (Alpha) does, before Tronchetto.
  expect(lines(await bodyRows(screen))).toEqual(['Alpha', 'Beta']);
});
