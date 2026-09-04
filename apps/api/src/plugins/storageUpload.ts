/**
 * Fastify plugin for generic storage upload and download.
 *
 * Endpoints:
 *  - GET  /uploads/:bucket/*          — Authenticated asset proxy; streams from the active provider
 *                                       (works with both local FS and S3-compatible storage).
 *  - POST /storage/upload/:uploadId   — Authenticated multipart upload to `uploads`, `exports`,
 *                                       or `assets` buckets. Bucket-level RBAC enforced.
 *  - GET  /storage/download?token=..  — Download via HMAC-signed token; no session required.
 *
 * @fastify/multipart must be registered globally before this plugin (done in server.ts).
 */


import type { StorageBucket } from '@luke/core';
import { APP_STORAGE_BUCKETS, hasPermission } from '@luke/core';
import { type PrismaClient } from '@luke/db';

import { authenticateRequest as auth } from '../lib/auth';
import { getTraceId } from '../lib/error';
import { putObject, getObject, getStorageProvider } from '../storage';
import { verifyDownloadToken } from '../utils/downloadToken';
import { streamRawResponse } from '../utils/streamResponse';

import type { Context } from '../lib/trpc';
import type { FastifyInstance } from 'fastify';

/** Safely extracts the string `.value` from a parsed @fastify/multipart form field. */
function getMultipartFieldValue(field: unknown): string | undefined {
  if (field && typeof field === 'object' && !Array.isArray(field) && 'value' in field) {
    const value = (field as { value: unknown }).value;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

/**
 * Registers the storage upload/download routes on the Fastify instance.
 */
export async function storagePlugin(
  fastify: FastifyInstance,
  options: { prisma: PrismaClient }
) {
  const { prisma } = options;

  /**
   * GET /uploads/:bucket/*
   * Authenticated proxy for storage assets — works with both the local provider and S3-compatible storage.
   * Authentication happens in the Next.js route handler; this route is internal-only.
   * Replaces the old fastify-static: works for any provider (local/S3).
   */
  fastify.get<{
    Params: { bucket: string; '*': string };
  }>('/uploads/:bucket/*', async (request, reply) => {
    const { bucket, '*': key } = request.params;

    if (!bucket || !key) {
      reply.code(400).send({ error: 'Bad Request' });
      return;
    }

    // Allowlist, not denylist: only public application buckets pass through this generic
    // proxy (no per-bucket allowlist/RBAC below, unlike the POST /storage/upload/:uploadId
    // route further down). Internal/sensitive buckets like "backups" stay excluded by
    // default — a future private bucket doesn't require remembering to add a carve-out
    // here. "backups" is served exclusively through the dedicated admin-only
    // maintenance.backup route.
    if (!(APP_STORAGE_BUCKETS as readonly string[]).includes(bucket)) {
      reply.code(403).send({ error: 'Forbidden' });
      return;
    }

    // Block path traversal: no segment may be '..' or contain dangerous characters
    const segments = key.split('/');
    if (segments.some(s => s === '..' || s === '.' || s === '')) {
      reply.code(400).send({ error: 'Bad Request' });
      return;
    }

    try {
      const provider = await getStorageProvider(prisma);
      const { stream, contentType } = await provider.get({
        bucket: bucket as StorageBucket,
        key,
      });

      // Buffer the stream to avoid ERR_STREAM_WRITE_AFTER_END when AWS SDK
      // SdkStream errors mid-pipe after headers are already sent.
      const chunks: Buffer[] = [];
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as unknown as ArrayBuffer));
      }
      const buffer = Buffer.concat(chunks);

      reply.header('Content-Type', contentType || 'application/octet-stream');
      reply.header('Content-Length', buffer.length);
      reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      reply.send(buffer);
    } catch (err) {
      fastify.log.warn({ err, bucket, key }, 'Storage GET failed');
      reply.code(404).send({ error: 'Not Found' });
    }
  });

  // Note: @fastify/multipart is already registered globally in server.ts
  // Don't register it again here to avoid conflicts

  /**
   * POST /storage/upload/:uploadId
   * File upload via multipart/form-data
   */
  fastify.post<{
    Params: { uploadId: string };
  }>('/storage/upload/:uploadId', async (request, reply) => {
    // Authentication required
    const session = await auth(request, reply, prisma);
    if (!session) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Autenticazione richiesta',
      });
      return;
    }

    try {
      // Get file from multipart
      const data = await request.file();

      if (!data) {
        reply.code(400).send({
          error: 'Bad Request',
          message: 'Nessun file ricevuto',
        });
        return;
      }

      // Extract metadata from the form
      const bucket = getMultipartFieldValue(data.fields.bucket) || 'uploads';
      const originalName =
        getMultipartFieldValue(data.fields.originalName) || data.filename || 'unnamed';

      // Validate bucket
      if (!['uploads', 'exports', 'assets'].includes(bucket)) {
        reply.code(400).send({
          error: 'Bad Request',
          message: 'Bucket non valido',
        });
        return;
      }

      // Enforce bucket-level RBAC via the unified permission system:
      // - uploads: any authenticated user (no additional permission)
      // - exports: config:read (editor and admin)
      // - assets:  config:update (admin only)
      const bucketPermission: Record<string, Parameters<typeof hasPermission>[1] | null> = {
        uploads: null,
        exports: 'config:read',
        assets: 'config:update',
      };
      const requiredPermission = bucketPermission[bucket];
      if (requiredPermission !== null && requiredPermission !== undefined &&
          !hasPermission(session.user as { role: 'admin' | 'editor' | 'viewer' }, requiredPermission)) {
        reply.code(403).send({
          error: 'Forbidden',
          message: 'Non autorizzato per questo bucket',
        });
        return;
      }

      // Determine content type
      const contentType = data.mimetype || 'application/octet-stream';

      // Create context for the service layer
      const ctx: Context = {
        session,
        prisma,
        traceId: getTraceId(request) || 'unknown',
        req: request,
        res: reply,
        logger: request.log,
      };

      // Upload file via the service layer
      const fileObject = await putObject(ctx, {
        bucket: bucket as StorageBucket,
        originalName,
        contentType,
        size: 0, // Size is calculated from the stream
        stream: data.file,
      });

      reply.code(201).send({
        id: fileObject.id,
        bucket: fileObject.bucket,
        key: fileObject.key,
        originalName: fileObject.originalName,
        size: fileObject.size,
        contentType: fileObject.contentType,
        checksumSha256: fileObject.checksumSha256,
        createdAt: fileObject.createdAt.toISOString(),
      });
    } catch (error) {
      fastify.log.error(
        {
          error: error instanceof Error ? error.message : 'Unknown',
          uploadId: request.params.uploadId,
        },
        'Upload error'
      );

      reply.code(500).send({
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Errore upload file',
      });
    }
  });

  /**
   * GET /storage/download?token=...
   * File download via signed token
   */
  fastify.get<{
    Querystring: { token: string };
  }>('/storage/download', async (request, reply) => {
    const { token } = request.query;

    if (!token) {
      reply.code(400).send({
        error: 'Bad Request',
        message: 'Token mancante',
      });
      return;
    }

    try {
      // Verify HMAC token
      const payload = verifyDownloadToken(token);

      // Create a minimal context (no session required, the token authorizes)
      // But the audit log needs a session if one is available
      const session = await auth(request, reply, prisma);

      // Retrieve metadata from the DB via bucket+key
      const fileObject = await prisma.fileObject.findFirst({
        where: {
          bucket: payload.bucket,
          key: payload.key,
        },
      });

      if (!fileObject) {
        reply.code(404).send({
          error: 'Not Found',
          message: 'File non trovato',
        });
        return;
      }

      // Create context for the service layer
      const ctx: Context = {
        session,
        prisma,
        traceId: getTraceId(request) || 'unknown',
        req: request,
        res: reply,
        logger: request.log,
      };

      // Download file via the service layer
      const { stream, metadata } = await getObject(ctx, fileObject.id);

      streamRawResponse(
        reply,
        stream,
        {
          'Content-Type': metadata.contentType,
          'Content-Length': metadata.size,
          // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- Content-Disposition:attachment forces download and prevents inline rendering; Content-Type is the one saved in metadata, not sniffed from the client
          'Content-Disposition': `attachment; filename="${encodeURIComponent(metadata.originalName)}"`,
          'Cache-Control': 'private, max-age=300', // 5 minutes
        },
        err => fastify.log.error({ err, fileObjectId: fileObject.id }, 'Storage download stream failed')
      );
    } catch (error) {
      fastify.log.error(
        {
          error: error instanceof Error ? error.message : 'Unknown',
        },
        'Download error'
      );

      if (
        error instanceof Error &&
        (error.message.includes('scaduto') ||
          error.message.includes('invalido'))
      ) {
        reply.code(401).send({
          error: 'Unauthorized',
          message: error.message,
        });
        return;
      }

      reply.code(500).send({
        error: 'Internal Server Error',
        message:
          error instanceof Error ? error.message : 'Errore download file',
      });
    }
  });
}
