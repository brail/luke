/**
 * Plugin Fastify per upload e download file storage
 *
 * - GET  /uploads/:bucket/*         - Stream asset autenticato dal provider attivo
 * - POST /storage/upload/:uploadId  - Upload multipart
 * - GET  /storage/download?token=.. - Download con token firmato
 *
 * Note: @fastify/multipart è registrato globalmente in server.ts
 */

import type { FastifyInstance } from 'fastify';
import { type PrismaClient } from '@prisma/client';

import type { StorageBucket } from '@luke/core';
import { hasPermission } from '@luke/core';

import { authenticateRequest as auth } from '../lib/auth';
import { putObject, getObject, getStorageProvider } from '../storage';
import { verifyDownloadToken } from '../utils/downloadToken';

import type { Context } from '../lib/trpc';

/**
 * Plugin Fastify per storage upload/download
 */
export async function storagePlugin(
  fastify: FastifyInstance,
  options: { prisma: PrismaClient }
) {
  const { prisma } = options;

  /**
   * GET /uploads/:bucket/*
   * Proxy autenticato per asset storage — funziona sia con provider locale che MinIO.
   * L'autenticazione avviene nel Next.js route handler; questa route è internal-only.
   * Sostituisce il vecchio fastify-static: funziona per qualsiasi provider (local/MinIO).
   */
  fastify.get<{
    Params: { bucket: string; '*': string };
  }>('/uploads/:bucket/*', async (request, reply) => {
    const { bucket, '*': key } = request.params;

    if (!bucket || !key) {
      reply.code(400).send({ error: 'Bad Request' });
      return;
    }

    // Blocca path traversal: nessun segmento deve essere '..' o contenere caratteri pericolosi
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

  // Note: @fastify/multipart è già registrato globalmente in server.ts
  // Non registrare di nuovo qui per evitare conflitti

  /**
   * POST /storage/upload/:uploadId
   * Upload file con multipart/form-data
   */
  fastify.post<{
    Params: { uploadId: string };
  }>('/storage/upload/:uploadId', async (request, reply) => {
    // Autenticazione richiesta
    const session = await auth(request, reply);
    if (!session) {
      reply.code(401).send({
        error: 'Unauthorized',
        message: 'Autenticazione richiesta',
      });
      return;
    }

    try {
      // Ottieni file da multipart
      const data = await request.file();

      if (!data) {
        reply.code(400).send({
          error: 'Bad Request',
          message: 'Nessun file ricevuto',
        });
        return;
      }

      // Estrai metadati dal form
      const bucket = (data.fields.bucket as any)?.value || 'uploads';
      const originalName =
        (data.fields.originalName as any)?.value || data.filename || 'unnamed';

      // Valida bucket
      if (!['uploads', 'exports', 'assets'].includes(bucket)) {
        reply.code(400).send({
          error: 'Bad Request',
          message: 'Bucket non valido',
        });
        return;
      }

      // Enforce bucket-level RBAC tramite sistema permessi unificato:
      // - uploads: qualsiasi utente autenticato (nessun permesso aggiuntivo)
      // - exports: config:read (editor e admin)
      // - assets:  config:update (solo admin)
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

      // Determina content type
      const contentType = data.mimetype || 'application/octet-stream';

      // Crea context per service layer
      const ctx: Context = {
        session,
        prisma,
        traceId: (request as any).traceId || 'unknown',
        req: request,
        res: reply,
        logger: request.log,
      };

      // Upload file tramite service layer
      const fileObject = await putObject(ctx, {
        bucket: bucket as StorageBucket,
        originalName,
        contentType,
        size: 0, // Size viene calcolato dallo stream
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
   * Download file con token firmato
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
      // Verifica token HMAC
      const payload = verifyDownloadToken(token);

      // Crea context minimale (no session required, token autorizza)
      // Ma per audit log serve session se disponibile
      const session = await auth(request, reply);

      // Recupera metadati da DB tramite bucket+key
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

      // Crea context per service layer
      const ctx: Context = {
        session,
        prisma,
        traceId: (request as any).traceId || 'unknown',
        req: request,
        res: reply,
        logger: request.log,
      };

      // Download file tramite service layer
      const { stream, metadata } = await getObject(ctx, fileObject.id);

      // Imposta headers
      reply.header('Content-Type', metadata.contentType);
      reply.header('Content-Length', metadata.size);
      reply.header(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(metadata.originalName)}"`
      );
      reply.header('Cache-Control', 'private, max-age=300'); // 5 minuti

      // Stream file
      reply.send(stream);
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
