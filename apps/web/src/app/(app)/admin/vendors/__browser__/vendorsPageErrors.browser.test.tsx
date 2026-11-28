import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import VendorsPage from '../page';

/**
 * A create's CONFLICT reaches the user with the server's text (#248): the NAV link already taken,
 * or the action's idempotency key sent again with other data. Every other vendor action keeps
 * naming the NAV link, the only CONFLICT they raise.
 */

const { toastError, options } = vi.hoisted(() => ({
  toastError: vi.fn(),
  /** Each vendors mutation's options, by procedure name, from the last render. */
  options: {} as Record<string, { onError: (error: unknown) => void }>,
}));

vi.mock('../../../../../lib/trpc', () => {
  const mutation = (name: string) => ({
    useMutation: (opts: { onError: (error: unknown) => void }) => {
      options[name] = opts;
      return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
    },
  });
  return {
    trpc: {
      useUtils: () => ({ vendors: { list: { invalidate: () => undefined } } }),
      vendors: {
        list: { useQuery: () => ({ data: { items: [] }, isLoading: false, error: null }) },
        ...Object.fromEntries(['create', 'update', 'remove', 'restore', 'unlink', 'hardDelete'].map(n => [n, mutation(n)])),
      },
    },
  };
});
vi.mock('../../../../../contexts/useInvalidateContext', () => ({ useInvalidateContext: () => () => undefined }));
vi.mock('../../../../../hooks/usePermission', () => ({ usePermission: () => ({ can: () => true }) }));
vi.mock('../_components/VendorDialog', () => ({ VendorDialog: () => null }));
vi.mock('../_components/VendorTable', () => ({ VendorTable: () => null }));
vi.mock('sonner', () => ({ toast: { error: toastError, success: vi.fn() } }));

afterEach(() => toastError.mockReset());

const conflict = (message: string) => ({ message, data: { code: 'CONFLICT' } });

test.each([
  'Questa operazione è già stata inviata con dati diversi: ricarica e riprova',
  'Questo fornitore NAV è già collegato a un altro fornitore',
])('a create shows the server text of its CONFLICT: %s', async text => {
  await render(<VendorsPage />);

  options.create.onError(conflict(text));

  expect(toastError).toHaveBeenCalledWith(text);
});

test('an update still names the NAV link for its CONFLICT', async () => {
  await render(<VendorsPage />);

  options.update.onError(conflict('any'));

  expect(toastError).toHaveBeenCalledWith('Codice NAV già collegato a un altro fornitore');
});
