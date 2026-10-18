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
