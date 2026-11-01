/**
 * What the upload routes share: the limits that make `@fastify/multipart` stop reading at each kind
 * of asset's size, instead of buffering up to a global ceiling and checking afterwards, and the one
 * answer to a failed upload.
 */

import { Readable } from 'stream';

import { type MultipartFile } from '@fastify/multipart';
import { TRPCError } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';

import { ASSET_KINDS, type AssetKind } from '@luke/core';

import { getTraceId } from './error';
import { fileTooLargeMessage, streamToBuffer } from './imageUpload';

import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * The default of every multipart route: the largest kind of asset. Fields stay unset because the
 * backup import needs its own, and it raises the file size per request.
 */
export const MULTIPART_GLOBAL_LIMITS = {
  fileSize: Math.max(...Object.values(ASSET_KINDS).map(kind => kind.maxSizeBytes)),
  files: 1,
};

/** One file of `kind` and, unless raised, nothing else. A route with a field adds it and its part. */
export function uploadLimits(kind: AssetKind) {
  return { fileSize: ASSET_KINDS[kind].maxSizeBytes, files: 1, fields: 0, parts: 1 };
}

/** A file part as the services take it. At its limit the stream ends cut, and only `truncated` says so. */
export async function toUploadFile(part: MultipartFile, kind: AssetKind) {
  const buffer = await streamToBuffer(part.file);
  if (part.file.truncated) {
    throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: fileTooLargeMessage(ASSET_KINDS[kind].maxSizeBytes) });
  }
  return { filename: part.filename, mimetype: part.mimetype, stream: Readable.from(buffer), size: buffer.length };
}

export type UploadFile = Awaited<ReturnType<typeof toUploadFile>>;

export function noFileError() {
  return new TRPCError({ code: 'BAD_REQUEST', message: 'Nessun file ricevuto' });
}

/** The request's only file, read within the limits of `kind`. */
export async function readUploadFile(req: FastifyRequest, kind: AssetKind) {
  const data = await req.file({ limits: uploadLimits(kind) });
  if (!data) throw noFileError();
  return toUploadFile(data, kind);
}

/** `@fastify/multipart` error codes attributable to the client. */
const CLIENT_MULTIPART_ERROR_CODES = new Set([
  'FST_INVALID_MULTIPART_CONTENT_TYPE',
  'FST_REQ_FILE_TOO_LARGE',
  'FST_FILES_LIMIT',
  'FST_PARTS_LIMIT',
  'FST_FIELDS_LIMIT',
  'FST_PROTO_VIOLATION',
  'FST_INVALID_JSON_FIELD_ERROR',
]);

function isClientMultipartError(error: unknown): boolean {
  // `unknown` narrowed by hand: these errors come from several libraries, with no common type.
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && CLIENT_MULTIPART_ERROR_CODES.has(code)) {
    return true;
  }

  // busboy (the parser underneath @fastify/multipart) reports malformed bodies —
  // "Multipart: Boundary not found" and similar — with an Error that has no `code`.
  return error instanceof Error && error.message.startsWith('Multipart: ');
}

/**
 * Answers a failed upload: a tRPC error with its own status, as the global handler does; a malformed
 * request with 400 and a fixed text, since the parser's was not written for the caller; anything
 * else with 500 and `failure.message`, so internals stay out. A 4xx logs its message, since it is
 * the caller's; a 5xx logs the error.
 */
export function sendUploadError(
  req: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  failure: { log: string; message: string }
) {
  const traceId = getTraceId(req);
  const answer = (status: number, code: string, message: string) => {
    req.log.warn({ traceId }, `${failure.log}: ${message}`);
    return reply.code(status).send({ error: code, message });
  };

  if (error instanceof TRPCError) {
    const status = getHTTPStatusCodeFromError(error);
    if (status < 500) return answer(status, error.code, error.message);
  } else if (isClientMultipartError(error)) {
    return answer(400, 'Bad Request', 'Richiesta di upload non valida');
  }

  req.log.error({ err: error, traceId }, failure.log);
  return reply.code(500).send({ error: 'Internal Server Error', message: failure.message });
}
