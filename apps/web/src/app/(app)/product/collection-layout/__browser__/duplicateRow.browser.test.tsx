import { expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../components/ui/tooltip';
import { CollectionLayoutTable } from '../_components/CollectionLayoutTable';

import type { ComponentProps } from 'react';

/**
 * Duplicating a row (#56): a row without quotations duplicates at once; a row with quotations asks
 * whether the copy takes them, with the copy that takes them as the default answer.
 */

vi.mock('../../../../../lib/trpc', () => {
  const answers: Record<string, unknown> = {
    'phaseAlert.criticalityForLayout': [],
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

const quotation = (id: string) => ({ id, order: 0, pricingParameterSetId: null, retailPrice: 100, supplierQuotation: null, notes: null, sku: null });

const row = (id: string, line: string, quotations: unknown[]) => ({
  id, line, productCategory: 'BOOT', status: 'NEW', strategy: null, gender: 'MAN', article: null, designer: null,
  phaseId: null, pictureUrl: null, pricePositioning: null, skuForecast: 1, qtyForecast: 1, styleStatus: null, vendor: null, quotations,
});

type Props = ComponentProps<typeof CollectionLayoutTable>;

const layout = {
  id: 'layout-1',
  hiddenColumns: [],
  groups: [{
    id: 'g1', name: 'Scarpe', collectionLayoutId: 'layout-1', skuBudget: null,
    rows: [row('a', 'Alpha', []), row('b', 'Beta', [quotation('q1'), quotation('q2')])],
  }],
} as unknown as Props['layout']; // Only the fields the table reads; the rest of the router output is irrelevant here.

const noop = () => {};

async function renderTable(props: Partial<Props> = {}) {
  const onDuplicateRow = vi.fn();
  const screen = await render(
    <TooltipProvider>
      <CollectionLayoutTable
        layout={layout} canUpdate parameterSets={[]} onAddGroup={noop} onAddRow={noop} onEditRow={noop}
        onDuplicateRow={onDuplicateRow} onDeleteRow={noop} onRenameGroup={noop} onDeleteGroup={noop} onUpdateSettings={noop} {...props}
      />
    </TooltipProvider>
  );
  await expect.element(screen.getByText('Beta')).toBeVisible();
  return { onDuplicateRow, screen };
}

/** The Duplica button of the row showing `line`. */
function duplicateButton(screen: Awaited<ReturnType<typeof renderTable>>['screen'], line: string) {
  const tr = [...screen.container.querySelectorAll('tbody tr')].find(t => t.textContent?.includes(line));
  const button = tr?.querySelector<HTMLButtonElement>('button:has(svg.lucide-copy)');
  if (!button) throw new Error(`No Duplica button on the row ${line}`);
  return button;
}

test('a row without quotations duplicates at once', async () => {
  const { onDuplicateRow, screen } = await renderTable();

  await userEvent.click(duplicateButton(screen, 'Alpha'));

  expect(onDuplicateRow).toHaveBeenCalledWith('a', true);
  expect(screen.getByRole('alertdialog').query()).toBeNull();
});

test('a row with quotations asks, and Enter takes the copy with them', async () => {
  const { onDuplicateRow, screen } = await renderTable();

  await userEvent.click(duplicateButton(screen, 'Beta'));
  await expect.element(screen.getByText('La riga ha 2 quotazioni. Duplicarle insieme alla riga?')).toBeVisible();
  expect(onDuplicateRow).not.toHaveBeenCalled();

  await expect.element(screen.getByRole('button', { name: 'Con le quotazioni' })).toHaveFocus();
  await userEvent.keyboard('{Enter}');

  expect(onDuplicateRow).toHaveBeenCalledWith('b', true);
});

test('"Senza quotazioni" duplicates the row without them, "Annulla" does nothing', async () => {
  const { onDuplicateRow, screen } = await renderTable();

  await userEvent.click(duplicateButton(screen, 'Beta'));
  await screen.getByRole('button', { name: 'Annulla' }).click();
  expect(onDuplicateRow).not.toHaveBeenCalled();

  await userEvent.click(duplicateButton(screen, 'Beta'));
  await screen.getByRole('button', { name: 'Senza quotazioni' }).click();
  expect(onDuplicateRow).toHaveBeenCalledWith('b', false);
});

test('while a duplicate is saved, Duplica waits', async () => {
  const { screen } = await renderTable({ isDuplicatingRow: true });

  expect(duplicateButton(screen, 'Alpha').disabled).toBe(true);
});
