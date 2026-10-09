import { type ComponentProps } from 'react';
import { expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { ParameterSetDialog } from '../ParameterSetDialog';

/**
 * The panel hands the edit dialog its set rebuilt on every render, and it re-renders whenever the
 * session is refetched, which next-auth does each time the tab regains focus. The dialog reset its
 * form whenever that object changed identity, so switching windows wiped the edits in progress.
 */

type Props = ComponentProps<typeof ParameterSetDialog>;
type ParameterSet = NonNullable<Props['initialData']>;

const leather: ParameterSet = {
  id: 'set-1',
  isDefault: true,
  name: 'Pelle',
  countryCode: 'IT',
  purchaseCurrency: 'USD',
  sellingCurrency: 'EUR',
  qualityControlPercent: 5,
  transportInsuranceCost: 2.5,
  duty: 12,
  exchangeRate: 1.07,
  italyAccessoryCosts: 0.3,
  tools: 1,
  retailMultiplier: 2.5,
  optimalMargin: 50,
};
const textile: ParameterSet = { ...leather, id: 'set-2', isDefault: false, name: 'Tessuto' };

/** Spreads the set anew on every call, as the panel does on every render. */
function dialog(props: Partial<Props> = {}) {
  return (
    <ParameterSetDialog
      open
      mode="edit"
      initialData={{ ...leather }}
      onOpenChange={vi.fn()}
      onSubmit={vi.fn()}
      {...props}
    />
  );
}

test('an edit survives a re-render that passes an equal set', async () => {
  const screen = await render(dialog());
  await screen.getByLabelText('Nome variante').fill('Pelle rivista');

  await screen.rerender(dialog());

  await expect.element(screen.getByLabelText('Nome variante')).toHaveValue('Pelle rivista');
});

test('every opening starts from the data it is given', async () => {
  const screen = await render(dialog());
  const name = screen.getByLabelText('Nome variante');
  await name.fill('Pelle rivista');
  await expect.element(screen.getByRole('switch')).toBeChecked();

  await screen.rerender(dialog({ open: false }));
  await screen.rerender(dialog({ initialData: { ...textile } }));
  await expect.element(name).toHaveValue('Tessuto');
  await expect.element(screen.getByRole('switch')).not.toBeChecked();

  await screen.rerender(dialog({ open: false }));
  await screen.rerender(dialog({ mode: 'create', initialData: undefined }));
  await expect.element(name).toHaveValue('');
});

test('a wheel scroll over a focused number field does not change it', async () => {
  const screen = await render(dialog());
  const fields = screen.getByRole('spinbutton').all();
  expect(fields).toHaveLength(8);

  for (const field of fields) {
    // A spinbutton here is an `<input type="number">`; `element()` types it as a plain `Element`.
    const before = (field.element() as HTMLInputElement).value;
    await field.click();
    await userEvent.wheel(field, { delta: { y: -100 } });
    // `wheel` resolves before the page handles the event: wait for the blur, after which the
    // browser no longer steps the field, so the value check cannot pass before the step lands.
    await expect.element(field).not.toHaveFocus();
    await expect.element(field).toHaveValue(Number(before));
  }
});
