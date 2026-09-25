/**
 * Fastify plugin for the generic storage asset proxy.
 *
 * Endpoint:
 *  - GET  /uploads/:bucket/*  — Internal asset proxy; streams from the active provider (local FS
 *                               or S3-compatible). No session check here: the Next.js
 *                               `/api/uploads/[...path]` route authenticates upstream, and this
 *                               route relies on the API being unreachable from outside.
 *
 * Uploads go through `storage.requestUpload`/`confirmUpload` and the per-asset-kind `/upload/*`
 * routes in `src/routes/`.
 */


import type { StorageBucket } from '@luke/core';
import { APP_STORAGE_BUCKETS } from '@luke/core';
import { type PrismaClient } from '@luke/db';

import { getStorageProvider } from '../storage';

import type { FastifyInstance } from 'fastify';

/**
 * Registers the storage asset proxy route on the Fastify instance.
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
    // proxy (there is no per-bucket RBAC below). Internal/sensitive buckets like "backups"
    // stay excluded by default — a future private bucket doesn't require remembering to add a
    // carve-out here. "backups" is served exclusively through the passphrase-protected backup
    // export route (`routes/backupExportDownload.ts`).
    if (!(APP_STORAGE_BUCKETS as readonly string[]).includes(bucket)) {
      reply.code(403).send({ error: 'Forbidden' });
      return;
    }

    // Block path traversal: reject empty, '.' and '..' segments. Character filtering happens in
    // the Next.js proxy and in the local provider (`isPathSafe`).
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
}
