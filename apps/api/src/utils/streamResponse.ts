/**
 * Streams a Node.js Readable directly to the client, bypassing Fastify's `reply.send()`.
 *
 * `reply.send(stream)` has been observed to silently truncate large streamed responses under
 * this Fastify version (Content-Length reset to 0, empty body, "stream closed prematurely"
 * logged) — reproduced with multi-MB backup blobs sourced from the MinIO provider's underlying
 * `http.IncomingMessage`. `reply.hijack()` + writing directly to the raw Node response avoids
 * whatever internal handling causes this.
 */

import type { FastifyReply } from 'fastify';

export function streamRawResponse(
  reply: FastifyReply,
  stream: NodeJS.ReadableStream,
  headers: Record<string, string | number>,
  onError: (err: unknown) => void
): void {
  reply.hijack();
  reply.raw.writeHead(200, headers);
  stream.on('error', err => {
    onError(err);
    reply.raw.destroy();
  });
  stream.pipe(reply.raw);
}
