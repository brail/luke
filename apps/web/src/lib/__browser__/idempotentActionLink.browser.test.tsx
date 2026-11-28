import { QueryClient } from '@tanstack/react-query';
import { createTRPCReact } from '@trpc/react-query';
import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import type { AppRouter } from '@luke/api';

import { useIdempotentAction } from '../idempotencyKey';
import { browserLinks } from '../trpcLinks';

/**
 * The key reaches the request through the real path (#248): `useMutation`'s `mutateAsync` hands
 * the payload to the link as the same object, which is what ties a key to it. A tRPC or React
 * Query upgrade that copied the input would drop every key silently; this test would catch it.
 */

const trpc = createTRPCReact<AppRouter>();

function NewVendor() {
  const action = useIdempotentAction(trpc.vendors.create.useMutation());
  return <button type="button" onClick={() => action.submit({ name: 'Vendor', moqPerColor: 100 })}>Crea</button>;
}

afterEach(() => vi.unstubAllGlobals());

test('a create and its retry after a lost answer reach the API alone, with one key', async () => {
  const keys: Array<string | null> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: unknown, init?: Parameters<typeof fetch>[1]) => {
      keys.push(new Headers(init?.headers).get('idempotency-key'));
      throw new TypeError('Failed to fetch'); // the answer never arrives
    })
  );
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const client = trpc.createClient({ links: browserLinks('api-token') });
  const screen = await render(
    <trpc.Provider client={client} queryClient={queryClient}>
      <NewVendor />
    </trpc.Provider>
  );

  await screen.getByRole('button', { name: 'Crea' }).click();
  await vi.waitFor(() => expect(keys).toHaveLength(1));
  await screen.getByRole('button', { name: 'Crea' }).click();
  await vi.waitFor(() => expect(keys).toHaveLength(2));

  expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(keys[1]).toBe(keys[0]);
});
