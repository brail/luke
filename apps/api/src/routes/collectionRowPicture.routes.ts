/**
 * Plugin Fastify per upload foto CollectionLayoutRow
 * Endpoint: POST /upload/collection-row-picture/:rowId
 *           POST /upload/collection-row-picture/temp
 *
 * Features:
 * - Autenticazione richiesta
 * - Rate limiting: 30 req/min per utente autenticato
 * - Validazione MIME: png, jpeg, webp
 * - Size limit: 5MB
 * - Upload tramite storage service
 * - Aggiornamento CollectionLayoutRow.pictureUrl
 */

import rateLimit from '@fastify/rate-limit';
import { uploadCollectionRowPicture } from '../services/collectionRowPicture.service';
import { authenticateRequest } from '../lib/auth';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { isDevelopment } from '@luke/core';

export default async function collectionRowPictureRoutes(
  app: FastifyInstance,
  options: { prisma: PrismaClient }
) {
  // Rate limiting per utente autenticato (con fallback a IP se non autenticato)
  await app.register(rateLimit, {
    max: isDevelopment() ? 100 : 30, // 30 req/min in prod per utente
    timeWindow: '1 minute',
    keyGenerator: (req: any) => {
      // Se autenticato, usa user ID; altrimenti usa IP
      return (req as any).session?.user?.id || req.ip;
    },
  });
    app.post<{
      Params: { rowId: string };
    }>('/upload/collection-row-picture/:rowId', async (req, reply) => {
      const session = await authenticateRequest(req, reply);
      if (!session) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Autenticazione richiesta',
        });
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
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'Nessun file ricevuto',
          });
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

        return reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Errore durante upload foto',
        });
      }
    });

}
