import { describe, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { getTrpcErrorMessage } from '../../lib/trpcErrorMessages';
import { useStorageUpload } from '../useStorageUpload';

/**
 * `useStorageUpload` sends the file to the API upload route it is given, and nowhere else. The
 * browser never talks to storage: on 3.0 SeaweedFS sits on an internal network, and the presigned
 * PUT this hook used to send for the company logo failed in production (CORS on the public storage
 * host).
 */

const UPLOAD_URL = '/upload/company-logo';

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn<(url: string, init: { method: string; headers: Record<string, string>; body: FormData }) => Promise<Response>>(),
}));

vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 'session-token' } }) }));

type Upload = ReturnType<typeof useStorageUpload>['upload'];

async function renderUpload(): Promise<Upload> {
  let upload: Upload | null = null;
  function Harness() {
    upload = useStorageUpload({ url: UPLOAD_URL }).upload;
    return null;
  }
  await render(<Harness />);
  if (upload === null) throw new Error('useStorageUpload did not render');
  return upload;
}

describe('useStorageUpload', () => {
  test('posts the file to the API route, never to storage', async () => {
    const answer = { publicUrl: '/api/uploads/company-assets/logo.png', fileObjectId: 'fo-1', key: 'logo.png' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(answer), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const upload = await renderUpload();
    const file = new File(['png-bytes'], 'logo.png', { type: 'image/png' });
    const outcome = await upload(file).then(result => result, (err: unknown) => err);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(UPLOAD_URL);
    expect(init.method).toBe('POST');
    expect(init.body.get('file')).toBe(file);
    expect(init.headers).toEqual({ Authorization: 'Bearer session-token' });
    expect(outcome).toEqual(answer);
  });

  test("a refused upload shows the route's own message", async () => {
    const refusal = { error: 'Bad Request', message: 'File corrotto o tipo non valido' };
    fetchMock.mockResolvedValue(new Response(JSON.stringify(refusal), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const upload = await renderUpload();
    const error = await upload(new File(['x'], 'logo.png', { type: 'image/png' })).then(() => null, (err: unknown) => err);

    expect(getTrpcErrorMessage(error)).toBe(refusal.message);
  });
});
