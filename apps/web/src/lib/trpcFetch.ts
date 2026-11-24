import { trpcLaneOf } from '@luke/core';

/** What a proxy or a rewrite answers when the API cannot be reached. */
export const GATEWAY_STATUSES = new Set([502, 503, 504]);

/**
 * How long a background call (heartbeat, SSE ticket) may hang: a dead VPN leaves a request open
 * until the browser gives up, and the next tick should not wait behind it.
 */
const BACKGROUND_TIMEOUT_MS = 15_000;

/**
 * The `fetch` of Luke's tRPC links. The link parses every non-OK body as a tRPC error, and an answer
 * that is not one would reach the screen with no code, only the parser's or the gateway's text. So:
 * - a gateway status whose body is not a tRPC error (a proxy's page, or a gateway's own JSON) becomes
 *   a tRPC error envelope with the code `SERVICE_UNAVAILABLE` and no reason (#259);
 * - the global request limiter's 429 (its body is not a tRPC error, ADR-051) becomes
 *   `TOO_MANY_REQUESTS` with `retryAfterSeconds` from its `Retry-After`, the shape of the API's own
 *   rate-limit errors, so callers wait as long as the server asks.
 * Any other answer, and the API's own errors, pass unchanged. A background call is aborted after
 * `BACKGROUND_TIMEOUT_MS`.
 */
export async function trpcFetch(...[input, init]: Parameters<typeof fetch>): Promise<Response> {
  // A pass-through: the calling link builds the headers, `forwardedFor(...)` included where it calls
  // apps/api for a user (`trpcAuth.ts`), and they travel unchanged in `init`.
  // nosemgrep: luke-server-api-call-forwarded-for -- pass-through of the link's own request
  const response = await fetch(input, withBackgroundTimeout(input, init));
  if (response.status !== 429 && !GATEWAY_STATUSES.has(response.status)) return response;
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  if (isTrpcError(body)) return response;
  if (response.status === 429) {
    // JSON-RPC's code for tRPC's TOO_MANY_REQUESTS.
    return Response.json(
      {
        error: {
          message: 'Too many requests',
          code: -32029,
          data: { code: 'TOO_MANY_REQUESTS', httpStatus: 429, retryAfterSeconds: retryAfterSeconds(response) },
        },
      },
      { status: 429 }
    );
  }
  // JSON-RPC's code for every 5xx tRPC error, so the link reads it as a tRPC error response.
  return Response.json(
    { error: { message: 'Service unavailable', code: -32603, data: { code: 'SERVICE_UNAVAILABLE', httpStatus: 503 } } },
    { status: 503 }
  );
}

/**
 * The seconds of a response's `Retry-After`, when it is a whole number of seconds (the form apps/api
 * sends); `undefined` when it is absent or anything else.
 */
function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get('retry-after')?.trim();
  return header && /^\d+$/.test(header) ? Number(header) : undefined;
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

/** `init` with a timeout when the request is a background-lane call (ADR-051's lists). */
function withBackgroundTimeout(input: FetchInput, init: FetchInit): FetchInit {
  const url = input instanceof Request ? input.url : String(input);
  // The links send a path relative to the page (`/trpc/...`) in the browser; the base only parses it.
  if (trpcLaneOf(new URL(url, 'http://relative.invalid').pathname) !== 'background') return init;
  // In place of the link's own signal, which only cancels on unsubscribe: mutations expose no
  // cancellation, and `AbortSignal.any` is missing before Safari 17.4, which Next still targets.
  return { ...init, signal: AbortSignal.timeout(BACKGROUND_TIMEOUT_MS) };
}

/** Whether `body` is a tRPC error response, which carries a code the web can read. */
function isTrpcError(body: unknown): boolean {
  const data = (body as { error?: { data?: { code?: unknown } } } | null)?.error?.data;
  return typeof data?.code === 'string';
}
