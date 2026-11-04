import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { proxyUpload } from '../uploadProxy';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function upload(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://web.test${path}`, {
    method: 'POST',
    headers,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk-1|'));
        controller.enqueue(new TextEncoder().encode('chunk-2'));
        controller.close();
      },
    }),
    ...{ duplex: 'half' },
  });
}

describe('proxyUpload', () => {
  it('streams the body to the same API path with only the headers the API reads', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"id":"b1"}', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );

    const response = await proxyUpload(
      upload('/upload/backup-import?label=a', {
        Authorization: 'Bearer token-1',
        'Content-Type': 'multipart/form-data; boundary=x',
        Cookie: 'next-auth.session-token=secret',
        'X-Forwarded-For': '203.0.113.9, 10.0.0.5',
      })
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3001/upload/backup-import?label=a');
    expect(init).toMatchObject({ method: 'POST', duplex: 'half' });
    expect(init?.headers).toEqual({
      Authorization: 'Bearer token-1',
      'Content-Type': 'multipart/form-data; boundary=x',
      'X-Forwarded-For': '10.0.0.5',
    });
    expect(init?.body).toBeInstanceOf(ReadableStream);
    expect(await new Response(init?.body).text()).toBe('chunk-1|chunk-2');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ id: 'b1' });
  });

  it('answers with the API status, message and headers', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"message":"Troppe richieste"}', {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
      })
    );

    const response = await proxyUpload(upload('/upload/backup-import'));

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await response.json()).toEqual({ message: 'Troppe richieste' });
  });

  it('answers 502 when the API cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const response = await proxyUpload(upload('/upload/backup-import'));

    expect(response.status).toBe(502);
  });

  it.each([
    ['a segment outside the safe set', '/upload/brand-logo/a%2Fb'],
    ['a path that leaves /upload/', '/upload/%2e%2e/trpc/users.list'],
    ['the bare prefix', '/upload'],
  ])('refuses %s without calling the API', async (_case, path) => {
    const response = await proxyUpload(upload(path));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
