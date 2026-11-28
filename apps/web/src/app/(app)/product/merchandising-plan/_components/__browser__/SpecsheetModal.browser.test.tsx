import { type ComponentProps } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { SpecsheetModal } from '../SpecsheetModal';

/**
 * The API reads the session from the `Authorization: Bearer` header only. The specsheet image
 * upload was a hand-written `fetch` that sent cookies and no header, so every upload was refused.
 */

const h = vi.hoisted(() => ({
  fetch: vi.fn<(url: string, init: { method: string; headers: Record<string, string> }) => Promise<Response>>(),
  deleteImage: vi.fn(),
  specsheet: {
    id: 'spec-1',
    components: [],
    images: [] as Array<{ id: string; url: string; isDefault: boolean; caption: string | null }>,
  },
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
        deleteImage: { useMutation: () => ({ mutate: h.deleteImage, isPending: false }) },
      },
    },
  };
});

// The upload reads only the id; the header's other fields render empty, which this test ignores.
const row = { id: 'row-1' } as ComponentProps<typeof SpecsheetModal>['row'];

afterEach(() => {
  vi.unstubAllGlobals();
  h.deleteImage.mockReset();
  h.specsheet.images = [];
});

test('an image upload carries the session token', async () => {
  h.fetch.mockResolvedValue(new Response(JSON.stringify({ id: 'img-1', publicUrl: '/x.png' }), { status: 200 }));
  vi.stubGlobal('fetch', h.fetch);
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

/** Deleting a specsheet image cannot be undone, so it asks first (#303). */
test('deleting an image asks first; Annulla keeps it and the specsheet open', async () => {
  h.specsheet.images = [{ id: 'img-1', url: '/x.png', isDefault: false, caption: null }];
  const screen = await render(<SpecsheetModal open onOpenChange={vi.fn()} row={row} canUpdate onSaved={vi.fn()} />);

  await screen.getByTitle('Elimina immagine').click();
  await expect.element(screen.getByRole('alertdialog')).toBeInTheDocument();
  expect(h.deleteImage).not.toHaveBeenCalled();

  await screen.getByRole('button', { name: 'Annulla' }).click();
  expect(h.deleteImage).not.toHaveBeenCalled();
  await expect.element(screen.getByRole('dialog')).toBeInTheDocument();

  await screen.getByTitle('Elimina immagine').click();
  await screen.getByRole('button', { name: 'Elimina' }).click();
  expect(h.deleteImage).toHaveBeenCalledTimes(1);
  expect(h.deleteImage).toHaveBeenCalledWith({ id: 'img-1' });
});
