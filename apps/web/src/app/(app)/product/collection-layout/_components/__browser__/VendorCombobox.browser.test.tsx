import { afterEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { VendorCombobox } from '../VendorCombobox';

/**
 * The vendor list is searched on the server: `vendors.list` returns at most 100 vendors, so a list
 * filtered in the browser could not reach the rest, and a row whose vendor fell outside the first
 * page showed the placeholder instead of its vendor (X26).
 */

type Item = { id: string; name: string; nickname: string | null };

const h = vi.hoisted(() => ({
  inputs: [] as unknown[],
  /** The server's answer for each search; `''` is the unfiltered list. */
  pages: {} as Record<string, Item[]>,
  loading: false,
}));

vi.mock('../../../../../../lib/trpc', () => ({
  trpc: {
    vendors: {
      list: {
        useQuery: (input: { search?: string } | undefined) => {
          h.inputs.push(input);
          if (h.loading) return { data: undefined, isPlaceholderData: false };
          const items = h.pages[input?.search ?? ''] ?? [];
          return { data: { items, nextCursor: null, hasMore: false }, isPlaceholderData: false };
        },
      },
    },
  },
}));

afterEach(() => {
  h.inputs.length = 0;
  h.pages = {};
  h.loading = false;
});

const lastSearch = () => (h.inputs.at(-1) as { search?: string } | undefined)?.search;

test('shows the row vendor even when no search result contains it', async () => {
  const screen = await render(
    <VendorCombobox
      value="v-far"
      selectedVendor={{ id: 'v-far', name: 'Zeta Tessuti Srl', nickname: null }}
      onChange={() => undefined}
    />,
  );
  await expect.element(screen.getByRole('combobox')).toHaveTextContent('Zeta Tessuti Srl');
});

test('sends what the user types to the server', async () => {
  const screen = await render(<VendorCombobox value={null} onChange={() => undefined} />);
  await screen.getByRole('combobox').click();
  await userEvent.type(screen.getByPlaceholder('Cerca fornitore…'), 'beta');
  await expect.poll(lastSearch).toBe('beta');
});

test('lists what the server returned, without filtering it again by label', async () => {
  // The server matches the name; the item is labelled with the nickname.
  h.pages = { beta: [{ id: 'v-1', name: 'Beta Srl', nickname: 'Alfa' }] };
  const onChange = vi.fn();
  const screen = await render(<VendorCombobox value={null} onChange={onChange} />);
  await screen.getByRole('combobox').click();
  await userEvent.type(screen.getByPlaceholder('Cerca fornitore…'), 'beta');
  await screen.getByRole('option', { name: 'Alfa' }).click();
  expect(onChange).toHaveBeenCalledWith('v-1', expect.objectContaining({ id: 'v-1' }));
});

test('does not let Enter pick from results that predate the search', async () => {
  h.pages = { '': [{ id: 'v-acme', name: 'Acme', nickname: null }], zeta: [{ id: 'v-zeta', name: 'Zeta', nickname: null }] };
  const onChange = vi.fn();
  const screen = await render(<VendorCombobox value={null} onChange={onChange} />);
  await screen.getByRole('combobox').click();
  await expect.element(screen.getByRole('option', { name: 'Acme' })).toBeVisible();
  await userEvent.type(screen.getByPlaceholder('Cerca fornitore…'), 'zeta{Enter}');
  expect(onChange).not.toHaveBeenCalledWith('v-acme', expect.anything());
  await expect.element(screen.getByRole('option', { name: 'Zeta' })).toBeVisible();
});

test('shows that the list is loading on the first open', async () => {
  h.loading = true;
  const screen = await render(<VendorCombobox value={null} onChange={() => undefined} />);
  await screen.getByRole('combobox').click();
  await expect.element(screen.getByText('Caricamento…')).toBeVisible();
});

test('says so when a search matches nothing', async () => {
  const screen = await render(<VendorCombobox value={null} onChange={() => undefined} />);
  await screen.getByRole('combobox').click();
  await userEvent.type(screen.getByPlaceholder('Cerca fornitore…'), 'zzz');
  await expect.element(screen.getByText('Nessun fornitore trovato.')).toBeVisible();
});
