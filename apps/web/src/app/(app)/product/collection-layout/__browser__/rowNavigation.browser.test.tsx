import { expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { TooltipProvider } from '../../../../../components/ui/tooltip';
import { CollectionLayoutTable } from '../_components/CollectionLayoutTable';
import { CollectionRowDrawer, type RowNavigation } from '../_components/CollectionRowDrawer';

import type { ComponentProps } from 'react';

/**
 * Previous / next in the row editor (#55): the table opens a row with the rows it shows, in board
 * order (groups, then each group's filter and sort); the editor moves through them by buttons and
 * `Alt+↑`/`Alt+↓`, and leaving a row with unsaved changes — by navigating or by closing — asks to
 * save, discard or stay.
 */

const PLANNING_GROUP_ID = vi.hoisted(() => '00000000-0000-4000-8000-000000000001');

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 't' }, status: 'authenticated' }) }));

vi.mock('../../../../../lib/trpc', () => {
  const band = (label: string) => ({ minDaysToDeadline: 0, maxDaysToDeadline: null, color: '#B91C1C', label, emphasis: 'outline' });
  const criticality = (rowId: string) => ({ rowId, state: 'active', band: band('In ritardo'), daysToDeadline: 1, reached: false, deadlineDay: null, eventTitle: null });
  const answers: Record<string, unknown> = {
    'phaseAlert.thresholds': {
      default: { bands: [band('In ritardo')] },
      completedBand: { label: 'Concluso', color: '#15803D', emphasis: 'solid' },
      completedLateBand: { label: 'Concluso in ritardo', color: '#B91C1C', emphasis: 'solid' },
    },
    'phaseAlert.criticalityForLayout': [criticality('a'), criticality('c')],
    'phase.list': [],
    'collectionCatalog.listAll': [],
    'planningGroup.list': [{ id: PLANNING_GROUP_ID, name: 'Planning' }],
  };
  const procedure = (path: string): unknown =>
    new Proxy(() => undefined, {
      get: (_target, key) => {
        if (key === 'useQuery') return () => ({ data: answers[path], isPending: false, isLoading: false, isError: false });
        if (key === 'useMutation') return () => ({ mutate: vi.fn(), isPending: false });
        if (key === 'useUtils') return () => procedure('utils');
        return procedure(path ? `${path}.${String(key)}` : String(key));
      },
    });
  return { trpc: procedure('') };
});

const tableRow = (id: string, line: string) => ({
  id, line, productCategory: 'BOOT', status: 'NEW', strategy: null, gender: 'MAN', article: null, designer: null,
  phaseId: null, pictureUrl: null, pricePositioning: null, skuForecast: 1, qtyForecast: 1, styleStatus: null, vendor: null, quotations: [],
});

type TableProps = ComponentProps<typeof CollectionLayoutTable>;

const layout = {
  id: 'layout-1',
  hiddenColumns: [],
  groups: [
    { id: 'g1', name: 'Scarpe', collectionLayoutId: 'layout-1', skuBudget: null, rows: [tableRow('a', 'Alpha'), tableRow('b', 'Beta')] },
    { id: 'g2', name: 'Borse', collectionLayoutId: 'layout-1', skuBudget: null, rows: [tableRow('c', 'Gamma')] },
  ],
} as unknown as TableProps['layout']; // Only the fields the table reads; the rest of the router output is irrelevant here.

const noop = () => {};

test('the table opens a row with the rows it shows, groups first, then the filter', async () => {
  const onEditRow = vi.fn();
  const screen = await render(
    <TooltipProvider>
      <CollectionLayoutTable
        layout={layout} canUpdate parameterSets={[]} onAddGroup={noop} onAddRow={noop} onEditRow={onEditRow}
        onDuplicateRow={noop} onDeleteRow={noop} onRenameGroup={noop} onDeleteGroup={noop} onUpdateSettings={noop}
      />
    </TooltipProvider>
  );

  await screen.getByText('Beta').click();
  expect(onEditRow).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b' }), ['a', 'b', 'c']);

  await screen.getByRole('button', { name: /^Criticità/ }).click();
  await screen.getByRole('menuitemcheckbox', { name: 'In ritardo' }).click();
  await userEvent.keyboard('{Escape}');
  await expect.element(screen.getByText('Beta')).not.toBeInTheDocument();

  // With a filter on, drag-and-drop is off and dnd-kit marks the row `aria-disabled`: the locator's
  // click waits for an enabled element, though the row still opens on a click.
  screen.getByText('Gamma').element().closest('tr')?.click();
  expect(onEditRow).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'c' }), ['a', 'c']);
});

type DrawerProps = ComponentProps<typeof CollectionRowDrawer>;

// The fields the drawer's form reads; the rest of the router output is irrelevant here.
const row = {
  id: 'r1', groupId: 'g1', planningGroupId: PLANNING_GROUP_ID, gender: 'MAN', vendorId: null, vendor: null, line: 'Alpha', article: null,
  status: 'NEW', skuForecast: 10, qtyForecast: 100, productCategory: 'BOOT', strategy: null, styleStatus: null,
  pricePositioning: null, phaseId: null, designer: null, pictureKey: null, pictureUrl: null, styleNotes: null,
  materialNotes: null, colorNotes: null, toolingNotes: null, toolingQuotation: null, completedAt: null, quotations: [],
} as unknown as NonNullable<DrawerProps['row']>;

const middle: RowNavigation = { position: 2, total: 3, previousRowId: 'r0', nextRowId: 'r2' };

function renderDrawer(navigation: RowNavigation = middle, props: Partial<DrawerProps> = {}) {
  const spies = { onNavigate: vi.fn(), onSubmit: vi.fn(), onOpenChange: vi.fn() };
  const screen = render(
    <TooltipProvider>
      <CollectionRowDrawer
        open mode="edit" row={row} groups={[{ id: 'g1', name: 'Scarpe' }] as unknown as DrawerProps['groups']}
        parameterSets={[]} availableGenders={['MAN']} brandId="brand-1" seasonId="season-1"
        navigation={navigation} onCompletionChanged={noop} {...spies} {...props}
      />
    </TooltipProvider>
  );
  return { ...spies, screen };
}

async function editLine(screen: Awaited<ReturnType<typeof renderDrawer>['screen']>) {
  await screen.getByRole('textbox', { name: 'Linea *' }).fill('Alpha bis');
}

test('a clean row moves at once, by button or Alt+arrow, and stops at the ends', async () => {
  const { onNavigate, screen } = renderDrawer();
  const s = await screen;
  await expect.element(s.getByText('2 di 3')).toBeVisible();

  await s.getByRole('button', { name: 'Successiva' }).click();
  expect(onNavigate).toHaveBeenLastCalledWith('r2');

  await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
  expect(onNavigate).toHaveBeenLastCalledWith('r0');
  expect(s.getByText('Modifiche non salvate').query()).toBeNull();
});

test('the first row has no previous', async () => {
  const { screen } = renderDrawer({ position: 1, total: 3, previousRowId: null, nextRowId: 'r2' });

  await expect.element((await screen).getByRole('button', { name: 'Precedente' })).toBeDisabled();
});

test('leaving a changed row asks: stay keeps it, discard moves on', async () => {
  const { onNavigate, onSubmit, screen } = renderDrawer();
  const s = await screen;
  await editLine(s);

  await s.getByRole('button', { name: 'Successiva' }).click();
  await s.getByRole('button', { name: 'Resta' }).click();
  expect(onNavigate).not.toHaveBeenCalled();
  await expect.element(s.getByRole('textbox', { name: 'Linea *' })).toHaveValue('Alpha bis');

  await s.getByRole('button', { name: 'Successiva' }).click();
  await s.getByRole('button', { name: 'Scarta' }).click();
  expect(onNavigate).toHaveBeenCalledWith('r2');
  expect(onSubmit).not.toHaveBeenCalled();
});

test('saving on the way saves the row with the row to open next', async () => {
  const { onNavigate, onSubmit, screen } = renderDrawer();
  const s = await screen;
  await editLine(s);

  await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
  await s.getByRole('button', { name: 'Salva', exact: true }).click();

  await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ line: 'Alpha bis' }), 'r2');
  expect(onNavigate).not.toHaveBeenCalled();
});

test('closing a changed row asks too', async () => {
  const { onOpenChange, screen } = renderDrawer();
  const s = await screen;
  await editLine(s);

  await s.getByRole('button', { name: 'Annulla' }).click();
  expect(onOpenChange).not.toHaveBeenCalled();
  await s.getByRole('button', { name: 'Scarta' }).click();

  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test('Alt+arrow in a multi-line text is the text\'s, not the navigation', async () => {
  const { onNavigate, screen } = renderDrawer();
  await expect.element((await screen).getByText('2 di 3')).toBeVisible();
  const notes = document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea');
  if (!notes) throw new Error('The drawer shows no multi-line text');

  notes.focus();
  await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');

  expect(onNavigate).not.toHaveBeenCalled();
});

test('while a save runs the row cannot be left', async () => {
  const { onNavigate, onOpenChange, screen } = renderDrawer(middle, { isLoading: true });
  const s = await screen;

  await expect.element(s.getByRole('button', { name: 'Successiva' })).toBeDisabled();
  await userEvent.keyboard('{Escape}');

  expect(onOpenChange).not.toHaveBeenCalled();
  expect(onNavigate).not.toHaveBeenCalled();
});
