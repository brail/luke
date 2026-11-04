import { buildApiUrl } from '@luke/core';

import { forwardedFor } from './clientIp';
import { debugError } from './debug';
import { isSafePathSegment } from './pathSegment';

/** Node's fetch requires it for a streamed body; the DOM `RequestInit` type does not declare it. */
const STREAMED_BODY = { duplex: 'half' };

/**
 * Forwards a browser upload (`POST /upload/...`) to the same path on apps/api, streaming the body.
 *
 * It replaces a `/upload/:path*` rewrite: Next's rewrite proxy passes on only the first
 * `proxyClientMaxBodySize` bytes of a body (10 MB by default) and silently drops the rest, and a
 * higher limit makes it hold a copy of the body in memory. A route handler reads the request
 * stream as it arrives. Only what the API reads is forwarded: the Bearer token, the multipart
 * boundary and the client IP its rate limits key on (CLAUDE.md rule 13), never the cookies.
 */
export async function proxyUpload(request: Request): Promise<Response> {
  // Parsing resolves dot segments, `%2e%2e` included, so the prefix is checked after it.
  const { pathname, search } = new URL(request.url);
  const [prefix, ...segments] = pathname.split('/').filter(Boolean);
  if (prefix !== 'upload' || segments.length === 0 || !segments.every(isSafePathSegment)) {
    return new Response('Bad Request', { status: 400 });
  }

  const authorization = request.headers.get('authorization');
  const contentType = request.headers.get('content-type');
  let response: Response;
  try {
    response = await fetch(buildApiUrl(pathname + search), {
      method: 'POST',
      headers: {
        ...(authorization && { Authorization: authorization }),
        ...(contentType && { 'Content-Type': contentType }),
        ...forwardedFor(request.headers),
      },
      body: request.body,
      // A browser that gives up the upload ends the API request too.
      signal: request.signal,
      ...STREAMED_BODY,
    });
  } catch (error) {
    debugError('Upload proxy error:', error);
    return new Response('Bad Gateway', { status: 502 });
  }

  // The API's headers pass on as the rewrite passed them (`Retry-After` on a 429 included), except
  // the two that described the encoded body fetch has already decoded.
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(response.body, { status: response.status, headers });
}
