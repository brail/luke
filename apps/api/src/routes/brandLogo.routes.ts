/**
 * Fastify plugin for brand logo upload.
 *
 * Endpoints:
 *  - POST /upload/brand-logo/:brandId  — replace the logo for an existing brand
 *  - POST /upload/brand-logo/temp      — upload a pending logo during brand creation
 *
 * Both endpoints require authentication and the appropriate RBAC permission.
 * Rate-limited to 30 req/min per user (100 in development) — scoped to these two
 * routes only; see the note on the exported function.
 * Accepted MIME types: image/png, image/jpeg, image/webp. Max size: 2 MB.
 * Writes are delegated to the storage service and produce an audit log entry.
 */

import { Readable } from 'stream';

import rateLimit from '@fastify/rate-limit';
import { TRPCError } from '@trpc/server';

import { isDevelopment } from '@luke/core';

import { rateLimitKeyFromRequest, requireSessionWithPermission } from '../lib/auth';
import { getTraceId, toErrorMessage } from '../lib/error';
import {
  uploadBrandLogo,
  uploadTempBrandLogo,
} from '../services/brandLogo.service';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

/**
 * `@fastify/multipart` error codes attributable to the client: non-multipart
 * body, too many files/parts/fields, file over the limit, protocol violation.
 *
 * Without this distinction they all ended up in the generic 500, presenting a
 * malformed request as a server fault — and hiding the real reason for the
 * rejection from the client.
 */
const CLIENT_MULTIPART_ERROR_CODES = new Set([
  'FST_INVALID_MULTIPART_CONTENT_TYPE',
  'FST_REQ_FILE_TOO_LARGE',
  'FST_FILES_LIMIT',
  'FST_PARTS_LIMIT',
  'FST_FIELDS_LIMIT',
  'FST_PROTO_VIOLATION',
]);

function isClientMultipartError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && CLIENT_MULTIPART_ERROR_CODES.has(code)) {
    return true;
  }

  // busboy (the parser underneath @fastify/multipart) reports malformed bodies —
  // "Multipart: Boundary not found" and similar — with an Error that has no `code`.
  // It's still a client error: without this check a corrupted body was
  // indistinguishable from an internal fault.
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message.startsWith('Multipart: ');
}

/**
 * Deliberately NOT wrapped in `fastify-plugin`: encapsulation is what keeps
 * the rate limiter below confined to these two routes. With `fp()` the limiter
 * ended up in the root scope and became the server's global limit — 30 req/min
 * per user on every route in production, tRPC batches included, instead of the
 * 100 per IP configured in `server.ts`. Same reason `specsheetImage` and
 * `collectionRowPicture` are plain async functions.
 */
export default async function brandLogoRoutes(
  app: FastifyInstance,
  options: { prisma: PrismaClient }
) {
  // Rate limiting per authenticated user (falls back to IP if not authenticated)
  await app.register(rateLimit, {
    max: isDevelopment() ? 100 : 30, // 30 req/min in prod per user
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyFromRequest,
  });

  app.post<{
    Params: { brandId: string };
  }>('/upload/brand-logo/:brandId', async (req, reply) => {
    const session = await requireSessionWithPermission(req, reply, 'brands:update', options.prisma);
    if (!session) return;

    const ctx = {
      session,
      prisma: options.prisma,
      traceId: getTraceId(req) || 'unknown',
      req,
      res: reply,
      logger: req.log,
    };

    try {
      // Receive multipart file
      const data = await req.file();
      if (!data) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Nessun file ricevuto',
        });
      }

      // Properly consume the multipart stream
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk as Buffer);
      }
      const buffer = Buffer.concat(chunks);

      // Upload via the service
      const result = await uploadBrandLogo(ctx, {
        brandId: req.params.brandId,
        file: {
          filename: data.filename,
          mimetype: data.mimetype,
          stream: Readable.from(buffer),
          size: buffer.length,
        },
      });

      return reply.code(200).send(result);
    } catch (error: unknown) {
      req.log.error(
        { error: toErrorMessage(error), brandId: req.params.brandId },
        'Brand logo upload error'
      );

      if (error instanceof TRPCError && (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND')) {
        return reply.code(error.code === 'NOT_FOUND' ? 404 : 400).send({
          error: error.code,
          message: error.message,
        });
      }

      if (isClientMultipartError(error)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: toErrorMessage(error),
        });
      }

      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Errore durante upload logo',
      });
    }
  });

  // Endpoint for temporary upload during brand creation
  app.post<{
    Body: { tempId: string };
  }>('/upload/brand-logo/temp', async (req, reply) => {
    const session = await requireSessionWithPermission(req, reply, 'brands:create', options.prisma);
    if (!session) return;

    const ctx = {
      session,
      prisma: options.prisma,
      traceId: getTraceId(req) || 'unknown',
      req,
      res: reply,
      logger: req.log,
    };

    try {
      let fileBuffer: Buffer | null = null;
      let filename = 'upload';
      let mimetype = 'application/octet-stream';

      for await (const part of req.parts()) {
        if (part.type === 'file') {
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk as Buffer);
          }
          fileBuffer = Buffer.concat(chunks);
          filename = part.filename;
          mimetype = part.mimetype;
        }
      }

      if (!fileBuffer) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Nessun file ricevuto',
        });
      }

      // Pending upload via the service
      const result = await uploadTempBrandLogo(ctx, {
        file: {
          filename,
          mimetype,
          stream: Readable.from(fileBuffer),
          size: fileBuffer.length,
        },
      });

      return reply.code(200).send(result);
    } catch (error: unknown) {
      // req.body is typed { tempId: string } by the route's generic, but with
      // multipart via req.parts() the body doesn't go through the JSON parser:
      // at runtime it can remain undefined despite the declared type.
      const tempId = (req.body as { tempId?: string } | undefined)?.tempId;
      req.log.error(
        { error: toErrorMessage(error), tempId },
        'Temp brand logo upload error'
      );

      if (error instanceof TRPCError && (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND')) {
        return reply.code(error.code === 'NOT_FOUND' ? 404 : 400).send({
          error: error.code,
          message: error.message,
        });
      }

      if (isClientMultipartError(error)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: toErrorMessage(error),
        });
      }

      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Errore durante upload temporaneo logo',
      });
    }
  });
}
