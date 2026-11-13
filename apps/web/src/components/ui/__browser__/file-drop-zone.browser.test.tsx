import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { FileDropZone } from '../file-drop-zone';

import type { ComponentProps } from 'react';

/**
 * The shared upload area (#54): a click selects it for a paste instead of opening the file picker,
 * which opens from `Sfoglia…` or with Enter; a drop still uploads. An area for any other file, as an
 * import dialog has, keeps the click that opens the picker.
 */

const png = () => new File(['png'], 'scarpa.png', { type: 'image/png' });

let openPicker: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // The picker is the hidden input's click: count it instead of opening a native dialog.
  openPicker = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const renderZone = (props: Partial<ComponentProps<typeof FileDropZone>> = {}) => {
  const onFile = vi.fn();
  const screen = render(
    <FileDropZone onFile={onFile} accept={['image/png']} {...props}>
      <p>Foto</p>
    </FileDropZone>
  );
  return { onFile, screen };
};

function withFile(file: File) {
  const data = new DataTransfer();
  data.items.add(file);
  return data;
}

test('a click selects the area without opening the picker, and a paste uploads the image', async () => {
  const { onFile, screen } = renderZone();
  const zone = (await screen).getByRole('group');

  await (await screen).getByText('Foto').click();

  await expect.element(zone).toHaveFocus();
  expect(openPicker).not.toHaveBeenCalled();

  const file = png();
  zone.element().dispatchEvent(new ClipboardEvent('paste', { clipboardData: withFile(file), bubbles: true, cancelable: true }));
  expect(onFile).toHaveBeenCalledWith(file);
});

test('Sfoglia… and Enter on the area open the picker, once each', async () => {
  const { screen } = renderZone();
  const browse = (await screen).getByRole('button', { name: 'Sfoglia…' });

  await browse.click();
  expect(openPicker).toHaveBeenCalledTimes(1);

  // Enter on the button is the button's: the area does not open the picker a second time.
  await userEvent.keyboard('{Enter}');
  expect(openPicker).toHaveBeenCalledTimes(2);

  (await screen).getByRole('group').element().focus();
  await userEvent.keyboard('{Enter}');
  expect(openPicker).toHaveBeenCalledTimes(3);
});

test('a drop uploads the file', async () => {
  const { onFile, screen } = renderZone();
  const file = png();

  (await screen).getByRole('group').element().dispatchEvent(new DragEvent('drop', { dataTransfer: withFile(file), bubbles: true, cancelable: true }));

  expect(onFile).toHaveBeenCalledWith(file);
});

test('a disabled area offers no Sfoglia… and ignores a paste', async () => {
  const { onFile, screen } = renderZone({ disabled: true });
  const zone = (await screen).getByRole('group');

  expect((await screen).getByRole('button', { name: 'Sfoglia…' }).query()).toBeNull();
  zone.element().dispatchEvent(new ClipboardEvent('paste', { clipboardData: withFile(png()), bubbles: true, cancelable: true }));

  expect(onFile).not.toHaveBeenCalled();
  expect(openPicker).not.toHaveBeenCalled();
});

test('an area for files other than images opens the picker on a click, with no Sfoglia…', async () => {
  const { screen } = renderZone({ accept: undefined });

  await (await screen).getByText('Foto').click();

  expect(openPicker).toHaveBeenCalledTimes(1);
  expect((await screen).getByRole('button', { name: 'Sfoglia…' }).query()).toBeNull();
});
