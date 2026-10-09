import { type ComponentProps } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { cleanup, render } from 'vitest-browser-react';

import { SpecsheetModal } from '../SpecsheetModal';

/**
 * The API reads the session from the `Authorization: Bearer` header only. The specsheet image
 * upload was a hand-written `fetch` that sent cookies and no header, so every upload was refused.
 */

const h = vi.hoisted(() => ({
  fetch: vi.fn<(url: string, init: { method: string; headers: Record<string, string> }) => Promise<Response>>(),
  specsheet: { id: 'spec-1', madeIn: null, supplierName: null, notes: null, components: [], images: [] },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { role: 'admin' }, accessToken: 't' } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../../../../lib/trpc', () => {
  const mutation = { useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }) };
  return {
    trpc: {
      useUtils: () => ({ merchandisingPlan: { getSpecsheet: { invalidate: vi.fn() } } }),
      merchandisingPlan: {
        getSpecsheet: { useQuery: () => ({ data: h.specsheet, isLoading: false }) },
        upsertSpecsheet: mutation,
        upsertComponents: mutation,
        setDefaultImage: mutation,
        deleteImage: mutation,
      },
    },
  };
});

// The upload reads only the id; the header's other fields render empty, which this test ignores.
const row = { id: 'row-1' } as ComponentProps<typeof SpecsheetModal>['row'];

// Unmount first: a render after the stubs are gone would call `buildApiUrl` without `process`.
afterEach(async () => {
  await cleanup();
  vi.unstubAllGlobals();
});

test('an image upload carries the session token', async () => {
  h.fetch.mockResolvedValue(new Response(JSON.stringify({ id: 'img-1', publicUrl: '/x.png' }), { status: 200 }));
  vi.stubGlobal('fetch', h.fetch);
  // `buildApiUrl` reads `process.env`, which Next inlines at build time and the test browser lacks.
  vi.stubGlobal('process', { env: {} });
  await render(<SpecsheetModal open onOpenChange={vi.fn()} row={row} canUpdate onSaved={vi.fn()} />);

  // The drop zone's file input carries no label of its own: it sits inside the dialog's portal.
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input[type="file"]');
  if (!input) throw new Error('The specsheet dialog shows no file input');
  await userEvent.upload(input, new File(['png'], 'scarpa.png', { type: 'image/png' }));

  await expect.poll(() => h.fetch.mock.calls.length).toBe(1);
  const [url, init] = h.fetch.mock.calls[0];
  expect(url).toContain('/upload/specsheet-image/spec-1');
  expect(init.headers).toMatchObject({ Authorization: 'Bearer t' });
});
