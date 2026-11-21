/**
 * `trpcFetch` through the link the browser uses: a proxy's HTML 503 reaches the screen as the neutral
 * unavailable text, not as the JSON parser's message, and a JSON answer passes unchanged (#259).
 */

import { createTRPCUntypedClient, httpBatchStreamLink } from '@trpc/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SERVICE_UNAVAILABLE_FALLBACK_MESSAGE } from '@luke/core';

import { getTrpcErrorMessage } from '../trpcErrorMessages';
import { trpcFetch } from '../trpcFetch';

function serverAnswers(response: Response) {
  vi.stubGlobal('fetch', vi.fn(async () => response));
}

async function failedQuery(fetchImpl?: typeof trpcFetch): Promise<unknown> {
  const client = createTRPCUntypedClient({
    links: [httpBatchStreamLink({ url: 'http://web.test/trpc', fetch: fetchImpl })],
  });
  return client.query('brand.list').catch((error: unknown) => error);
}

const PROXY_PAGE = () =>
  new Response('<html><body>503 Service Temporarily Unavailable</body></html>', {
    status: 503,
    headers: { 'content-type': 'text/html' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('trpcFetch', () => {
  it("turns a proxy's HTML 503 into SERVICE_UNAVAILABLE without a reason", async () => {
    serverAnswers(PROXY_PAGE());

    expect(getTrpcErrorMessage(await failedQuery(trpcFetch))).toBe(SERVICE_UNAVAILABLE_FALLBACK_MESSAGE);
  });

  it.each([
    ["a gateway's own JSON 503", () => Response.json({ message: 'no healthy upstream' }, { status: 503 })],
    ["a proxy's 502 page", () => new Response('<html>502 Bad Gateway</html>', { status: 502 })],
    ['a gateway timeout', () => new Response('', { status: 504 })],
  ])('turns %s into SERVICE_UNAVAILABLE without a reason', async (_name, answer) => {
    serverAnswers(answer());

    expect(getTrpcErrorMessage(await failedQuery(trpcFetch))).toBe(SERVICE_UNAVAILABLE_FALLBACK_MESSAGE);
  });

  it('is what the link needs: without it the same page reaches the screen as a parser error', async () => {
    serverAnswers(PROXY_PAGE());

    expect(getTrpcErrorMessage(await failedQuery())).not.toBe(SERVICE_UNAVAILABLE_FALLBACK_MESSAGE);
  });

  it("passes the API's own JSON 503 unchanged, reason included", async () => {
    serverAnswers(
      Response.json(
        {
          error: {
            message: 'Internal server error',
            code: -32603,
            data: { code: 'SERVICE_UNAVAILABLE', httpStatus: 503, unavailableReason: 'maintenance' },
          },
        },
        { status: 503 },
      ),
    );

    expect(getTrpcErrorMessage(await failedQuery(trpcFetch))).toBe('Sistema in manutenzione. Riprova più tardi.');
  });
});
