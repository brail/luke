/** What a proxy or a rewrite answers when the API cannot be reached. */
export const GATEWAY_STATUSES = new Set([502, 503, 504]);

/**
 * The `fetch` of Luke's tRPC links. A gateway status whose body is not a tRPC error (a proxy's page,
 * or a gateway's own JSON) becomes a tRPC error envelope with the code `SERVICE_UNAVAILABLE` and no
 * reason: the link parses every non-OK body as a tRPC error, and on anything else the error reaching
 * the screen would carry no code, only the parser's or the gateway's text (#259). Any other answer,
 * and the API's own errors, pass unchanged.
 */
export async function trpcFetch(...args: Parameters<typeof fetch>): Promise<Response> {
  // A pass-through: the calling link builds the headers, `forwardedFor(...)` included where it calls
  // apps/api for a user (`trpcAuth.ts`), and they travel unchanged in `args`.
  // nosemgrep: luke-server-api-call-forwarded-for -- pass-through of the link's own request
  const response = await fetch(...args);
  if (!GATEWAY_STATUSES.has(response.status)) return response;
  const body: unknown = await response
    .clone()
    .json()
    .catch(() => null);
  if (isTrpcError(body)) return response;
  // JSON-RPC's code for every 5xx tRPC error, so the link reads it as a tRPC error response.
  return Response.json(
    { error: { message: 'Service unavailable', code: -32603, data: { code: 'SERVICE_UNAVAILABLE', httpStatus: 503 } } },
    { status: 503 }
  );
}

/** Whether `body` is a tRPC error response, which carries a code the web can read. */
function isTrpcError(body: unknown): boolean {
  const data = (body as { error?: { data?: { code?: unknown } } } | null)?.error?.data;
  return typeof data?.code === 'string';
}
