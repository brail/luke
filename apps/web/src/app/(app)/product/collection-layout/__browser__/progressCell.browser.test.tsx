import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../components/ui/tooltip';
import { CollectionGroupSection } from '../_components/CollectionGroupSection';

import type { ComponentProps } from 'react';

/**
 * The progress cell stacks the phase-alert badge below the phase badge, both on the cell's left
 * edge, so the column is only as wide as the wider badge (#294); a row without an alert shows the
 * phase badge alone.
 */

vi.mock('../../../../../lib/trpc', () => {
  const answers: Record<string, unknown> = {
    'collectionCatalog.listAll': [],
    'phase.list': [{ id: 'phase-1', label: 'Prototipo', color: 'teal', isActive: true }],
    'phaseAlert.criticalityForLayout': [
      {
        rowId: 'row-1',
        state: 'active',
        band: { label: 'Critica', color: '#dc2626' },
        daysToDeadline: -3,
        reached: true,
        deadlineDay: '2026-11-20',
        eventTitle: 'Consegna prototipi',
        daysMode: 'calendar',
        relevantCountryCodes: [],
      },
    ],
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

const row = (id: string, line: string) => ({
  id, line, productCategory: null, status: null, strategy: null,
  gender: 'MAN', article: null, designer: null, phaseId: 'phase-1', pictureUrl: null, pricePositioning: null,
  skuForecast: 1, qtyForecast: 1, styleStatus: null, vendor: null, quotations: [],
});

type Props = ComponentProps<typeof CollectionGroupSection>;

const group = {
  id: 'group-1',
  name: 'Scarpe',
  collectionLayoutId: 'layout-1',
  skuBudget: null,
  rows: [row('row-1', 'Alpha'), row('row-2', 'Beta')],
} as unknown as Props['group']; // Only the fields the table reads; the rest of the router output is irrelevant here.

const noop = () => {};

async function renderTable() {
  const screen = await render(
    <TooltipProvider>
      <CollectionGroupSection
        group={group} canUpdate hiddenColumns={[]} parameterSets={[]} criticalityFilter={[]} selectedRowIds={new Set()}
        onAddRow={noop} onEditRow={noop} onDuplicateRow={noop} onDeleteRow={noop} onRenameGroup={noop}
        onDeleteGroup={noop} onToggleRowSelection={noop} onSelectAllRows={noop}
      />
    </TooltipProvider>
  );
  await expect.element(screen.getByText('Critica')).toBeInTheDocument();
  return screen;
}

/** The phase badge of the body row whose text contains `line`. */
function phaseBadgeIn(container: HTMLElement, line: string): HTMLElement {
  const tr = [...container.querySelectorAll('tbody tr')].find(r => r.textContent?.includes(line));
  const badge = [...(tr?.querySelectorAll('span') ?? [])].find(s => s.textContent === 'Prototipo');
  if (!badge) throw new Error(`no phase badge in row ${line}`);
  return badge;
}

test('the alert comes after the phase in a left-aligned column', async () => {
  const screen = await renderTable();
  const phase = phaseBadgeIn(screen.container, 'Alpha');
  const cell = phase.parentElement;
  const alert = screen.getByText('Critica').element();

  // The browser tests load no Tailwind CSS, so the layout is pinned by its classes, not by geometry.
  expect(cell?.classList).toContain('flex-col');
  expect(cell?.classList).toContain('items-start');
  expect(cell?.classList).not.toContain('flex-wrap');
  expect(cell?.children).toHaveLength(2);
  expect(cell?.children[0]).toBe(phase);
  expect(cell?.children[1]?.contains(alert)).toBe(true);
});

test('a row without an alert shows the phase badge alone', async () => {
  const screen = await renderTable();
  const cell = phaseBadgeIn(screen.container, 'Beta').parentElement;

  expect(cell?.children).toHaveLength(1);
});
