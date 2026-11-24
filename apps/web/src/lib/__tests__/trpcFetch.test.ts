/**
 * `trpcFetch` through the link the browser uses: a proxy's HTML 503 reaches the screen as the neutral
 * unavailable text, not as the JSON parser's message, and a JSON answer passes unchanged (#259). The
 * global limiter's 429 arrives as `TOO_MANY_REQUESTS` with its wait, and a background call cannot
 * hang (ADR-051).
 */

import { TRPCClientError, createTRPCUntypedClient, httpBatchStreamLink, httpLink } from '@trpc/client';
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

/** The `data` of the error a failed query reaches its caller with. */
async function failedQueryData(): Promise<unknown> {
  const error = await failedQuery(trpcFetch);
  expect(error).toBeInstanceOf(TRPCClientError);
  return (error as TRPCClientError<never>).data;
}

/** The body of the global limiter's 429 (`globalRateLimit.ts`, through `setGlobalErrorHandler`). */
const GLOBAL_LIMITER_429 = (headers: Record<string, string> = { 'retry-after': '37' }) =>
  Response.json(
    { error: true, message: 'Troppe richieste. Riprova più tardi.', code: 'TOO_MANY_REQUESTS', retryAfterSeconds: 37, traceId: 't' },
    { status: 429, headers }
  );

/** The `signal` the network saw for a call of `procedure` sent through `trpcFetch`. */
async function signalSentFor(procedure: string, linkSignal?: AbortSignal): Promise<AbortSignal | null | undefined> {
  const network = vi.fn(async (..._args: Parameters<typeof fetch>) => Response.json({ result: { data: null } }));
  vi.stubGlobal('fetch', network);
  const client = createTRPCUntypedClient({ links: [httpLink({ url: '/trpc', fetch: trpcFetch })] });
  await client.mutation(procedure, undefined, { signal: linkSignal });
  return network.mock.calls[0]?.[1]?.signal;
}

const PROXY_PAGE = () =>
  new Response('<html><body>503 Service Temporarily Unavailable</body></html>', {
    status: 503,
    headers: { 'content-type': 'text/html' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it("turns the global limiter's 429 into TOO_MANY_REQUESTS with its Retry-After", async () => {
    serverAnswers(GLOBAL_LIMITER_429());

    expect(await failedQueryData()).toMatchObject({ code: 'TOO_MANY_REQUESTS', httpStatus: 429, retryAfterSeconds: 37 });
  });

  it.each([
    ['no Retry-After', {}],
    ['a Retry-After that is a date', { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }],
    ['a negative Retry-After', { 'retry-after': '-5' }],
  ])('a global 429 with %s carries no wait', async (_name, headers) => {
    serverAnswers(GLOBAL_LIMITER_429(headers));

    const data = await failedQueryData();
    expect(data).toMatchObject({ code: 'TOO_MANY_REQUESTS', httpStatus: 429 });
    expect(data).not.toHaveProperty('retryAfterSeconds', expect.anything());
  });

  it("passes a procedure's own 429 unchanged", async () => {
    serverAnswers(
      Response.json(
        { error: { message: 'Slow down', code: -32029, data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429, retryAfterSeconds: 900 } } },
        { status: 429, headers: { 'retry-after': '5' } }
      )
    );

    expect(await failedQueryData()).toMatchObject({ code: 'TOO_MANY_REQUESTS', retryAfterSeconds: 900 });
  });

  it.each(['users.heartbeat', 'notifications.getSseTicket'])('aborts the background call %s after 15 seconds', async procedure => {
    const timer = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timer.signal);

    const signal = await signalSentFor(procedure);

    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(signal?.aborted).toBe(false);
    timer.abort();
    expect(signal?.aborted).toBe(true);
  });

  it.each(['me.get', 'brand.list'])('sets no timeout on %s', async procedure => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');

    await signalSentFor(procedure);

    expect(timeout).not.toHaveBeenCalled();
  });

});
