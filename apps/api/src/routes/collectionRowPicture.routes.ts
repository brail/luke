/**
 * Plugin Fastify per upload foto CollectionLayoutRow
 * Endpoint: POST /upload/collection-row-picture/temp  (create mode — no row ID)
 *           POST /upload/collection-row-picture/:rowId (edit mode — validates row)
 *
 * Upload stores the file in storage and returns the key.
 * The key is committed to DB when the form is saved (via tRPC rows.create / rows.update).
 */

import rateLimit from '@fastify/rate-limit';
import { uploadCollectionRowPicture, uploadTempCollectionRowPicture } from '../services/collectionRowPicture.service';
import { authenticateRequest } from '../lib/auth';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { isDevelopment, hasPermission, type Role } from '@luke/core';

export default async function collectionRowPictureRoutes(
  app: FastifyInstance,
  options: { prisma: PrismaClient }
) {
  await app.register(rateLimit, {
    max: isDevelopment() ? 100 : 30,
    timeWindow: '1 minute',
    keyGenerator: (req: any) => {
      return (req as any).session?.user?.id || req.ip;
    },
  });

  // Temp endpoint — no row ID required (create mode)
  // Registered before /:rowId so the literal "temp" path takes precedence.
  app.post('/upload/collection-row-picture/temp', async (req, reply) => {
    const session = await authenticateRequest(req, reply);
    if (!session) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Autenticazione richiesta' });
    }

    if (!hasPermission(session.user as { role: Role }, 'collection_layout:update')) {
      return reply.code(403).send({ error: 'Forbidden', message: 'Permesso negato: richiesta collection_layout:update' });
    }

    const ctx = {
      session,
      prisma: options.prisma,
      traceId: (req as any).traceId || 'unknown',
      req,
      res: reply,
      logger: req.log,
    };

    try {
      const data = await req.file();
      if (!data) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Nessun file ricevuto' });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk as Buffer);
      }
      const buffer = Buffer.concat(chunks);

      const result = await uploadTempCollectionRowPicture(ctx, {
        file: {
          filename: data.filename,
          mimetype: data.mimetype,
          stream: require('stream').Readable.from(buffer),
          size: buffer.length,
        },
      });

      return reply.code(200).send(result);
    } catch (error: any) {
      req.log.error({ error: error.message }, 'Temp collection row picture upload error');

      if (error.code === 'BAD_REQUEST') {
        return reply.code(400).send({ error: error.code, message: error.message });
      }

      return reply.code(500).send({ error: 'Internal Server Error', message: 'Errore durante upload foto' });
    }
  });

  app.post<{
    Params: { rowId: string };
  }>('/upload/collection-row-picture/:rowId', async (req, reply) => {
    const session = await authenticateRequest(req, reply);
    if (!session) {
      return reply.code(401).send({ error: 'Unauthorized', message: 'Autenticazione richiesta' });
    }

    if (!hasPermission(session.user as { role: Role }, 'collection_layout:update')) {
      return reply.code(403).send({ error: 'Forbidden', message: 'Permesso negato: richiesta collection_layout:update' });
    }

    const ctx = {
      session,
      prisma: options.prisma,
      traceId: (req as any).traceId || 'unknown',
      req,
      res: reply,
      logger: req.log,
    };

    try {
      const data = await req.file();
      if (!data) {
        return reply.code(400).send({ error: 'Bad Request', message: 'Nessun file ricevuto' });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk as Buffer);
      }
      const buffer = Buffer.concat(chunks);

      const result = await uploadCollectionRowPicture(ctx, {
        rowId: req.params.rowId,
        file: {
          filename: data.filename,
          mimetype: data.mimetype,
          stream: require('stream').Readable.from(buffer),
          size: buffer.length,
        },
      });

      return reply.code(200).send(result);
    } catch (error: any) {
      req.log.error(
        { error: error.message, rowId: req.params.rowId },
        'Collection row picture upload error'
      );

      if (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND') {
        return reply.code(error.code === 'NOT_FOUND' ? 404 : 400).send({
          error: error.code,
          message: error.message,
        });
      }

      return reply.code(500).send({ error: 'Internal Server Error', message: 'Errore durante upload foto' });
    }
  });
}
