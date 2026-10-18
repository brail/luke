/**
 * Streams a Node.js Readable directly to the client, bypassing Fastify's `reply.send()`.
 *
 * `reply.send(stream)` has been observed to silently truncate large streamed responses under
 * this Fastify version (Content-Length reset to 0, empty body, "stream closed prematurely"
 * logged) — reproduced with multi-MB backup blobs sourced from the S3 provider's underlying
 * `http.IncomingMessage`. `reply.hijack()` + writing directly to the raw Node response avoids
 * whatever internal handling causes this.
 */

import { pipeline, type Readable } from 'stream';

import type { FastifyReply } from 'fastify';

/**
 * `pipeline` destroys both ends when either fails: a client that goes away stops the source, and a
 * source that fails cuts the response short (its headers are already sent, so no late 500).
 * `onError` hears about failures of the source, not about a client leaving: when the client goes,
 * the response closes while the source is still alive, or after it has ended normally; when the
 * source fails or ends early, it is already destroyed, without having ended, by the time the
 * response closes.
 */
export function streamRawResponse(
  reply: FastifyReply,
  stream: Readable,
  headers: Record<string, string | number>,
  onError: (err: unknown) => void
): void {
  reply.hijack();
  reply.raw.writeHead(200, headers);
  let clientGone = false;
  reply.raw.on('close', () => {
    if (!reply.raw.writableFinished && (stream.readableEnded || !stream.destroyed)) clientGone = true;
  });
  pipeline(stream, reply.raw, err => {
    if (err && !clientGone) onError(err);
  });
}
