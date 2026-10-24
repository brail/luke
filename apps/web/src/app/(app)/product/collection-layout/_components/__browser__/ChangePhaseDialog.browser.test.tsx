import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { ChangePhaseDialog } from '../ChangePhaseDialog';

/**
 * The phase change proposes where the row goes next, read from its criticality (#159): the active
 * phase when the row is not at it yet, else the next one. The criticality describes the saved row,
 * so an unsaved phase or group change in the form proposes nothing, and neither does a criticality
 * still refetching after a save.
 */

const h = vi.hoisted(() => ({
  phases: [
    { id: 'design', label: 'Design', isActive: true },
    { id: 'proto', label: 'Prototipo', isActive: true },
    { id: 'prod', label: 'Produzione', isActive: true },
    { id: 'retired', label: 'Ritirata', isActive: false },
  ],
  // Widened from the literal `undefined`: each test sets its own partial criticality fixture.
  criticality: undefined as unknown,
  isFetching: false,
  onChanged: vi.fn(),
}));

vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    phase: { list: { useQuery: () => ({ data: h.phases }) } },
    phaseAlert: { criticalityForRow: { useQuery: () => ({ data: h.criticality, isFetching: h.isFetching }) } },
  },
}));

afterEach(() => {
  h.criticality = undefined;
  h.isFetching = false;
  h.onChanged.mockReset();
});

const active = (phaseId: string, nextPhaseId: string | null) =>
  ({ state: 'active', phaseId, nextPhase: nextPhaseId ? { phaseId: nextPhaseId } : null });

function dialog(savedPhaseId: string | null, form: { phaseId?: string | null; planningGroupId?: string } = {}) {
  return (
    <ChangePhaseDialog
      open
      onClose={() => undefined}
      onChanged={h.onChanged}
      saved={{ rowId: 'r1', phaseId: savedPhaseId, planningGroupId: 'g1' }}
      currentPhaseId={form.phaseId === undefined ? savedPhaseId : form.phaseId}
      currentPlanningGroupId={form.planningGroupId ?? 'g1'}
    />
  );
}

test.each([
  ['a row at its group\'s phase: the next phase', 'design', active('design', 'proto'), 'Prototipo'],
  ['a row with no phase: the active phase', null, active('design', 'proto'), 'Design'],
  ['a row at a phase its group does not plan: the active phase', 'prod', active('design', 'proto'), 'Design'],
])('proposes, for %s', async (_, savedPhaseId, criticality, expected) => {
  h.criticality = criticality;
  const screen = await render(dialog(savedPhaseId));

  await expect.element(screen.getByRole('combobox', { name: 'Nuova fase' })).toHaveTextContent(expected);
});

test.each([
  ['a concluded row', {}, { state: 'completed' }, 'Design'],
  ['an unsaved phase change', { phaseId: 'proto' }, active('design', 'prod'), 'Prototipo'],
  ['an unsaved group change', { planningGroupId: 'g2' }, active('design', 'proto'), 'Design'],
  ['a retired next phase', {}, active('design', 'retired'), 'Design'],
])('proposes nothing for %s on a row saved at Design: the form\'s phase stays selected', async (_, form, criticality, expected) => {
  h.criticality = criticality;
  const screen = await render(dialog('design', form));

  await expect.element(screen.getByRole('combobox', { name: 'Nuova fase' })).toHaveTextContent(expected);
});

test('proposes nothing while the criticality refetches after a save', async () => {
  // Saved from Design to Prototipo: the cached criticality, still Design's, would propose Design.
  h.criticality = active('design', 'proto');
  h.isFetching = true;
  const screen = await render(dialog('proto'));

  await expect.element(screen.getByRole('combobox', { name: 'Nuova fase' })).toHaveTextContent('Prototipo');
});

test('confirming without a pick sends the proposal', async () => {
  h.criticality = active('design', 'proto');
  const screen = await render(dialog('design'));

  await screen.getByRole('button', { name: 'Conferma cambio fase' }).click();

  expect(h.onChanged).toHaveBeenCalledWith('proto', undefined);
});

test('a pick overrides the proposal, and cancelling drops it', async () => {
  h.criticality = active('design', 'proto');
  const screen = await render(dialog('design'));
  const select = screen.getByRole('combobox', { name: 'Nuova fase' });

  await select.click();
  await screen.getByRole('option', { name: 'Produzione' }).click();
  await expect.element(select).toHaveTextContent('Produzione');

  await screen.getByRole('button', { name: 'Annulla' }).click();
  await expect.element(select).toHaveTextContent('Prototipo');
});
