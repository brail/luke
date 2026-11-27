import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { ConfirmDialog } from '../ConfirmDialog';

/**
 * The gated branch of `ConfirmDialog` is the one that already broke once.
 *
 * `lessons.md`, "A Radix close-button cannot double as a form's submit button":
 * the confirm control was an `AlertDialogAction`, which renders a Radix
 * `DialogClose`. React flushes the close synchronously for discrete events, so
 * the form detached from the document mid-click and the browser skipped the
 * submit. The dialog closed and deleted nothing. Typecheck, lint and the whole
 * suite were green — nothing about it is a type error — and a human found it.
 *
 * Only a real browser can assert the opposite, because the defect lives in the
 * order of a click's default action against a React state flush. That is the
 * entire reason this tier exists.
 *
 * ## The dialog must be driven by real state
 *
 * These tests render through `Harness`, which holds `open` in `useState`, and
 * that is load-bearing rather than tidy. With a static `open` and an inert
 * `onOpenChange`, the dialog never unmounts, the form stays attached, and the
 * submit fires even from a Radix `DialogClose` — so the regression reproduces
 * green and the test proves nothing. Verified: with an inert handler, the
 * broken component passed all four cases.
 */

/** Controlled exactly as production controls it: closing really closes. */
function Harness({
  onConfirm,
  onClosed,
  confirmPhrase,
}: {
  onConfirm: (phrase?: string) => void;
  onClosed?: () => void;
  confirmPhrase?: string;
}) {
  const [open, setOpen] = useState(true);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) onClosed?.();
      }}
      title="Elimina brand"
      description="Azione irreversibile."
      confirmText="Conferma"
      cancelText="Annulla"
      confirmPhrase={confirmPhrase}
      onConfirm={onConfirm}
    />
  );
}

test('a gated confirm actually submits: onConfirm receives the typed phrase', async () => {
  const onConfirm = vi.fn();
  const screen = await render(
    <Harness onConfirm={onConfirm} confirmPhrase="ELIMINA" />
  );

  await screen.getByRole('textbox').fill('ELIMINA');
  await screen.getByRole('button', { name: 'Conferma' }).click();

  // The assertion that would have caught the regression: not "the dialog
  // closed", but "the work was requested, with the phrase attached".
  expect(onConfirm).toHaveBeenCalledWith('ELIMINA');
});

test('the confirm stays disabled until the phrase matches exactly', async () => {
  const onConfirm = vi.fn();
  const screen = await render(
    <Harness onConfirm={onConfirm} confirmPhrase="ELIMINA" />
  );

  const confirm = screen.getByRole('button', { name: 'Conferma' });
  await expect.element(confirm).toBeDisabled();

  await screen.getByRole('textbox').fill('ELIMIN');
  await expect.element(confirm).toBeDisabled();

  await screen.getByRole('textbox').fill('ELIMINA');
  await expect.element(confirm).toBeEnabled();
});

test('an ungated confirm reaches onConfirm with no phrase', async () => {
  const onConfirm = vi.fn();
  const screen = await render(<Harness onConfirm={onConfirm} />);

  await screen.getByRole('button', { name: 'Conferma' }).click();

  // The ungated branch calls `handleConfirm()` with no argument, which reaches
  // `onConfirm` as an explicit `undefined` — one argument, not zero.
  expect(onConfirm).toHaveBeenCalledWith(undefined);
});

test('cancel never triggers the action', async () => {
  const onConfirm = vi.fn();
  const onClosed = vi.fn();
  const screen = await render(
    <Harness onConfirm={onConfirm} onClosed={onClosed} />
  );

  await screen.getByRole('button', { name: 'Annulla' }).click();

  expect(onConfirm).not.toHaveBeenCalled();
  expect(onClosed).toHaveBeenCalled();
});

/**
 * Once per opening (#248). These render the dialog open with an inert `onOpenChange`, on purpose:
 * it stands for a caller that has not re-rendered it closed yet (or the close animation), the
 * window in which a second click or key used to confirm again.
 */
function StaysOpen(props: Partial<Parameters<typeof ConfirmDialog>[0]> & { onConfirm: (phrase?: string) => void }) {
  return (
    <ConfirmDialog
      open
      onOpenChange={() => {}}
      title="Elimina brand"
      description="Azione irreversibile."
      confirmText="Conferma"
      {...props}
    />
  );
}

/** Two clicks dispatched back to back, before React can re-render between them. */
function doubleClick(element: Element) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

test('a double click confirms once', async () => {
  const onConfirm = vi.fn();
  const screen = await render(<StaysOpen onConfirm={onConfirm} />);

  doubleClick(screen.getByRole('button', { name: 'Conferma' }).element());

  expect(onConfirm).toHaveBeenCalledOnce();
});

test('a double click on a gated confirm submits once', async () => {
  const onConfirm = vi.fn();
  const screen = await render(<StaysOpen onConfirm={onConfirm} confirmPhrase="ELIMINA" />);
  await screen.getByRole('textbox').fill('ELIMINA');
  const confirm = screen.getByRole('button', { name: 'Conferma' });
  await expect.element(confirm).toBeEnabled();

  doubleClick(confirm.element());

  await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledWith('ELIMINA'));
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(onConfirm).toHaveBeenCalledOnce();
});

test.each([
  ['plain', undefined],
  ['gated', 'ELIMINA'],
])('a held Enter does not confirm again (%s)', async (_label, confirmPhrase) => {
  const screen = await render(<StaysOpen onConfirm={vi.fn()} confirmPhrase={confirmPhrase} actionType="warning" />);
  const target = screen.getByRole(confirmPhrase ? 'textbox' : 'button', { name: confirmPhrase ? undefined : 'Conferma' }).element();
  const press = (repeat: boolean) => new KeyboardEvent('keydown', { key: 'Enter', repeat, bubbles: true, cancelable: true });

  const first = press(false);
  const held = press(true);
  target.dispatchEvent(first);
  target.dispatchEvent(held);

  // The repeat's default action (clicking the focused button, submitting the form) is cancelled.
  expect(first.defaultPrevented).toBe(false);
  expect(held.defaultPrevented).toBe(true);
});

test('kept open after a confirm, it can confirm again once the attempt settles', async () => {
  const onConfirm = vi.fn();
  const screen = await render(<StaysOpen onConfirm={onConfirm} confirmPhrase="ELIMINA" closeOnConfirm={false} />);
  await screen.getByRole('textbox').fill('ELIMINA');
  await screen.getByRole('button', { name: 'Conferma' }).click();
  await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());

  // The caller's mutation runs, then fails: the dialog stays open for a retry.
  await screen.rerender(<StaysOpen onConfirm={onConfirm} confirmPhrase="ELIMINA" closeOnConfirm={false} isLoading />);
  await screen.rerender(<StaysOpen onConfirm={onConfirm} confirmPhrase="ELIMINA" closeOnConfirm={false} />);
  await screen.getByRole('button', { name: 'Conferma' }).click();

  await vi.waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
});

test('opened again, it confirms again', async () => {
  const onConfirm = vi.fn();
  const screen = await render(<StaysOpen onConfirm={onConfirm} />);
  await screen.getByRole('button', { name: 'Conferma' }).click();

  await screen.rerender(<StaysOpen onConfirm={onConfirm} open={false} />);
  await screen.rerender(<StaysOpen onConfirm={onConfirm} />);
  await screen.getByRole('button', { name: 'Conferma' }).click();

  expect(onConfirm).toHaveBeenCalledTimes(2);
});

test('closed on confirm, a loading flag falling while it still shows does not confirm again', async () => {
  const onConfirm = vi.fn();
  const screen = await render(<StaysOpen onConfirm={onConfirm} />);
  await screen.getByRole('button', { name: 'Conferma' }).click();

  // A caller passing a combined flag: something else finishes before the dialog has closed.
  await screen.rerender(<StaysOpen onConfirm={onConfirm} isLoading />);
  await screen.rerender(<StaysOpen onConfirm={onConfirm} />);
  await screen.getByRole('button', { name: 'Conferma' }).click();

  expect(onConfirm).toHaveBeenCalledOnce();
});

test('an onConfirm that throws leaves the action available', async () => {
  const onConfirm = vi.fn().mockImplementationOnce(() => {
    throw new Error('no target');
  });
  const screen = await render(<StaysOpen onConfirm={onConfirm} />);
  const confirm = screen.getByRole('button', { name: 'Conferma' }).element();
  const swallow = (event: ErrorEvent) => event.preventDefault();
  window.addEventListener('error', swallow);

  confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  confirm.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  window.removeEventListener('error', swallow);

  expect(onConfirm).toHaveBeenCalledTimes(2);
});
