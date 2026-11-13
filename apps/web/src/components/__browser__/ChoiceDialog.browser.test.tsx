import { expect, onTestFinished, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { ChoiceDialog } from '../ChoiceDialog';

/**
 * A question with two answers besides cancelling: each answer closes the dialog and runs its own
 * callback; the cancel only closes it; the focus starts on the cancel unless `focusPrimary`.
 */

function renderDialog(focusPrimary?: boolean) {
  const spies = { onOpenChange: vi.fn(), onSecondary: vi.fn(), onPrimary: vi.fn() };
  const screen = render(
    <ChoiceDialog
      open title="Modifiche non salvate" description="Vuoi salvarle?"
      cancelText="Resta" secondaryText="Scarta" primaryText="Salva" focusPrimary={focusPrimary}
      {...spies}
    />
  );
  return { ...spies, screen };
}

test('an answer closes the dialog, then runs its own callback only', async () => {
  const { onOpenChange, onSecondary, onPrimary, screen } = renderDialog();

  await (await screen).getByRole('button', { name: 'Scarta' }).click();

  expect(onOpenChange).toHaveBeenCalledWith(false);
  expect(onSecondary).toHaveBeenCalledOnce();
  expect(onOpenChange.mock.invocationCallOrder[0]).toBeLessThan(onSecondary.mock.invocationCallOrder[0]);
  expect(onPrimary).not.toHaveBeenCalled();
});

test('a double click answers once', async () => {
  const { onPrimary, screen } = renderDialog();
  const primary = (await screen).getByRole('button', { name: 'Salva' }).element();

  // Both clicks land before the caller re-renders the dialog closed.
  primary.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  primary.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  expect(onPrimary).toHaveBeenCalledOnce();
});

test('the cancel only closes, and has the focus by default', async () => {
  const { onOpenChange, onSecondary, onPrimary, screen } = renderDialog();
  const s = await screen;

  await expect.element(s.getByRole('button', { name: 'Resta' })).toHaveFocus();
  await userEvent.keyboard('{Enter}');

  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  expect(onSecondary).not.toHaveBeenCalled();
  expect(onPrimary).not.toHaveBeenCalled();
});

test('focusPrimary puts the focus on the primary answer: Enter takes it', async () => {
  const { onPrimary, screen } = renderDialog(true);

  await expect.element((await screen).getByRole('button', { name: 'Salva' })).toHaveFocus();
  await userEvent.keyboard('{Enter}');

  expect(onPrimary).toHaveBeenCalledOnce();
});

test('while closing it keeps the text it showed, whatever the caller passes then', async () => {
  // The runner loads no Tailwind: give the closing dialog an exit animation, so Radix keeps it in
  // the page while it plays, as the app does.
  const style = document.createElement('style');
  style.textContent = '@keyframes exit { to { opacity: 0 } } [role="alertdialog"][data-state="closed"] { animation: exit 1s }';
  document.head.append(style);
  onTestFinished(() => style.remove());
  const props = { onOpenChange: vi.fn(), onSecondary: vi.fn(), onPrimary: vi.fn(), cancelText: 'Resta', secondaryText: 'Scarta', primaryText: 'Salva' };
  const screen = await render(<ChoiceDialog open title="Modifiche non salvate" description="Prima di chiudere?" {...props} />);

  // The caller dropped its subject on closing, so its text falls back to another one.
  await screen.rerender(<ChoiceDialog open={false} title="Modifiche non salvate" description="Prima di passare?" {...props} />);

  expect(screen.getByText('Prima di passare?').query()).toBeNull();
  await expect.element(screen.getByText('Prima di chiudere?')).toBeInTheDocument();
});
