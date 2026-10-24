import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { TemplateItemDialog } from '../TemplateItemDialog';

/**
 * A new template item of a phase that declares a duration gets its offset proposed: the furthest
 * phase item's offset plus that duration (#158). The proposal never overwrites an offset the user
 * typed, and the item's own `Durata giorni` — the span of the event — is a different field it leaves
 * alone.
 */

const { DESIGN, PROTO } = vi.hoisted(() => ({ DESIGN: 'phase-design', PROTO: 'phase-proto' }));

vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    phase: {
      list: {
        useQuery: () => ({
          data: [
            { id: DESIGN, label: 'Design', durationDays: 30 },
            { id: PROTO, label: 'Prototipo', durationDays: 20 },
            { id: 'phase-meeting', label: 'Riunione', durationDays: null },
          ],
        }),
      },
    },
    seasonCalendar: {
      createTemplateItem: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      updateTemplateItem: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    company: { profile: { get: { useQuery: () => ({ data: undefined }) } } },
  },
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const dialog = (siblingItems: { id: string; title: string; phaseId: string | null; offsetDays: number }[] = []) => (
  <TemplateItemDialog open onClose={() => undefined} onSaved={() => undefined} templateId="t1" availableFunctions={[]} siblingItems={siblingItems} />
);

async function choosePhase(screen: Awaited<ReturnType<typeof render>>, label: string) {
  // The first combobox of the form is the phase.
  await screen.getByRole('combobox').nth(0).click();
  await screen.getByRole('option', { name: label }).click();
}

test("follows #158's example: Prototype after a Design item at +30 is proposed at +50", async () => {
  const screen = await render(dialog([{ id: 'i1', title: 'Design', phaseId: DESIGN, offsetDays: 30 }]));

  await choosePhase(screen, 'Prototipo');

  await expect.element(screen.getByLabelText('Offset giorni *')).toHaveValue(50);
  await expect.element(screen.getByLabelText('Durata giorni')).toHaveValue(1);
});

test('proposes the duration alone when the template has no phase item yet', async () => {
  const screen = await render(dialog([{ id: 'i1', title: 'Kickoff', phaseId: null, offsetDays: 90 }]));

  await choosePhase(screen, 'Design');

  await expect.element(screen.getByLabelText('Offset giorni *')).toHaveValue(30);
});

test('proposes nothing for a phase with no duration', async () => {
  const screen = await render(dialog());

  await choosePhase(screen, 'Riunione');

  await expect.element(screen.getByLabelText('Offset giorni *')).toHaveValue(0);
});

// 0 too, typed over another value: it equals the field's default, so "dirty" alone could not tell it
// was typed. (Typed over the untouched 0 it changes nothing, and React reports no change.)
test.each([7, 0])('leaves an offset the user typed: %i', async offset => {
  const screen = await render(dialog());

  await screen.getByLabelText('Offset giorni *').fill('5');
  await screen.getByLabelText('Offset giorni *').fill(String(offset));
  await choosePhase(screen, 'Prototipo');

  await expect.element(screen.getByLabelText('Offset giorni *')).toHaveValue(offset);
});

test('leaves an offset applied from the relative calculator', async () => {
  const screen = await render(dialog([{ id: 'i1', title: 'Design', phaseId: DESIGN, offsetDays: 30 }]));

  // Third combobox: the calculator's reference item, after the phase and the day count.
  await screen.getByRole('combobox').nth(2).click();
  await screen.getByRole('option', { name: 'Design (+30gg)' }).click();
  await screen.getByRole('button', { name: 'Usa' }).click();
  await choosePhase(screen, 'Prototipo');

  await expect.element(screen.getByLabelText('Offset giorni *')).toHaveValue(30);
});
