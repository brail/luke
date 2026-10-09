import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { ConfigImportDialog } from '../ConfigImportDialog';

/**
 * The file the config page exports carries `[ENCRYPTED]` in place of every secret, and an export
 * without values carries `value: null` on every row. Re-importing it overwrote each secret with the
 * placeholder; a `null` row made the dialog reject the whole file.
 */

const h = vi.hoisted(() => ({
  importMutate: vi.fn(),
  fetchExisting: vi.fn(),
  invalidate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  // The real `useUtils()` is one object for the component's lifetime.
  utils: {} as object,
}));

vi.mock('../../../lib/trpc', () => ({
  trpc: {
    useUtils: () =>
      Object.assign(h.utils, {
        config: { getMultiple: { fetch: h.fetchExisting }, invalidate: h.invalidate },
      }),
    config: { importJson: { useMutation: () => ({ mutateAsync: h.importMutate }) } },
  },
}));

vi.mock('sonner', () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

beforeEach(() => {
  vi.clearAllMocks();
  h.fetchExisting.mockResolvedValue([]);
  h.importMutate.mockResolvedValue({ successCount: 1, errorCount: 0, errors: [] });
});

/** Renders the dialog and picks a file with these rows, as the export writes them. */
async function selectFile(configs: object[]) {
  const screen = await render(
    <ConfigImportDialog onOpenChange={() => undefined} onSuccess={() => undefined} />,
  );
  const file = new File([JSON.stringify({ configs })], 'luke-config-export.json', {
    type: 'application/json',
  });
  await screen.getByLabelText('Seleziona file JSON').upload(file);
  return screen;
}

test('a row without a value is skipped and the other rows import', async () => {
  const screen = await selectFile([
    { key: 'auth.ldap.url', value: null, encrypt: true },
    { key: 'app.name', value: 'Luke', encrypt: false },
  ]);
  await screen.getByRole('button', { name: 'Importa Configurazioni' }).click();

  await expect
    .poll(() => h.importMutate.mock.calls)
    .toEqual([[{ items: [{ key: 'app.name', value: 'Luke', encrypt: false }] }]]);
  expect(h.toastSuccess).toHaveBeenCalledWith(expect.any(String), {
    description: 'Saltate: auth.ldap.url',
  });
});

test('re-importing an export skips every secret, names it, and refreshes the list', async () => {
  const screen = await selectFile([
    { key: 'auth.ldap.bindPassword', value: '[ENCRYPTED]', encrypt: true, category: 'auth' },
    { key: 'app.name', value: 'Luke', encrypt: false, category: 'app' },
  ]);
  await screen.getByRole('button', { name: 'Importa Configurazioni' }).click();

  await expect
    .poll(() => h.importMutate.mock.calls)
    .toEqual([[{ items: [{ key: 'app.name', value: 'Luke', encrypt: false }] }]]);
  expect(h.toastSuccess).toHaveBeenCalledWith(expect.any(String), {
    description: 'Saltate: auth.ldap.bindPassword',
  });
  expect(h.invalidate).toHaveBeenCalled();
});

test('the preview names why a row is skipped, and a malformed row does not reject the file', async () => {
  const screen = await selectFile([
    { key: 'auth.ldap.bindPassword', value: '[ENCRYPTED]', encrypt: true },
    { key: 'app.name', value: 42 },
  ]);

  await expect.element(screen.getByText(/Valore cifrato: l'export non lo contiene/)).toBeVisible();
  await expect.element(screen.getByText('riga 2')).toBeVisible();
  await expect.element(screen.getByText('0 configurazioni da importare')).toBeVisible();
});
