import { expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { Input } from '../input';

/**
 * Chromium steps a focused number input on a vertical wheel turn, so scrolling the page over a
 * field changed its value unnoticed. `Input` blurs a number field on that turn only.
 */

test('a vertical wheel turn blurs a focused number field and leaves its value', async () => {
  const onWheel = vi.fn();
  const screen = await render(<Input type="number" defaultValue={5} onWheel={onWheel} />);
  const field = screen.getByRole('spinbutton');

  await field.click();
  await userEvent.wheel(field, { delta: { y: -100 } });

  // `wheel` resolves before the page handles the event: wait for the blur, after which the
  // browser no longer steps the field, so the value check cannot pass before the step lands.
  await expect.element(field).not.toHaveFocus();
  await expect.element(field).toHaveValue(5);
  expect(onWheel).toHaveBeenCalled();
});

test('a sideways scroll over a number field, or a wheel turn over a text field, keeps the focus', async () => {
  const onWheel = vi.fn();
  const screen = await render(
    <>
      <Input type="number" defaultValue={5} onWheel={onWheel} />
      <Input type="text" onWheel={onWheel} />
    </>
  );
  // The caller's `onWheel` runs after the blur would have: once it has, the focus is settled.
  const number = screen.getByRole('spinbutton');
  await number.click();
  await userEvent.wheel(number, { delta: { x: 100 } });
  await expect.poll(() => onWheel.mock.calls.length).toBe(1);
  await expect.element(number).toHaveFocus();

  const text = screen.getByRole('textbox');
  await text.click();
  await userEvent.wheel(text, { delta: { y: -100 } });
  await expect.poll(() => onWheel.mock.calls.length).toBe(2);
  await expect.element(text).toHaveFocus();
});
