/**
 * Plugin Fastify per upload immagini MerchandisingSpecsheet
 * Endpoint: POST /upload/specsheet-image/:specsheetId
 *           POST /upload/specsheet-image/temp
 *
 * Features:
 * - Autenticazione richiesta
 * - Rate limiting: 30 req/min in prod
 * - Validazione MIME: png, jpeg, webp
 * - Size limit: 10MB
 */

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

import { isDevelopment } from '@luke/core';

import { authenticateRequest } from '../lib/auth';
import { uploadSpecsheetImage } from '../services/specsheetImage.service';

export default async function specsheetImageRoutes(
  app: FastifyInstance,
  options: { prisma: PrismaClient }
) {
  await app.register(rateLimit, {
    max: isDevelopment() ? 100 : 30,
    timeWindow: '1 minute',
    keyGenerator: (req: any) => (req as any).session?.user?.id || req.ip,
  });

  app.post<{ Params: { specsheetId: string } }>(
    '/upload/specsheet-image/:specsheetId',
    async (req, reply) => {
      const session = await authenticateRequest(req, reply);
      if (!session) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Autenticazione richiesta' });
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
        const parts = req.parts();
        let fileBuffer: Buffer | null = null;
        let filename = 'upload';
        let mimetype = 'application/octet-stream';
        let caption: string | undefined;

        for await (const part of parts) {
          if (part.type === 'field' && part.fieldname === 'caption') {
            caption = String(part.value);
          } else if (part.type === 'file') {
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
          return reply.code(400).send({ error: 'Bad Request', message: 'Nessun file ricevuto' });
        }

        const result = await uploadSpecsheetImage(ctx, {
          specsheetId: req.params.specsheetId,
          caption,
          file: {
            filename,
            mimetype,
            stream: require('stream').Readable.from(fileBuffer),
            size: fileBuffer.length,
          },
        });

        return reply.code(200).send(result);
      } catch (error: any) {
        req.log.error({ error: error.message, specsheetId: req.params.specsheetId }, 'Specsheet image upload error');

        if (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND') {
          return reply.code(error.code === 'NOT_FOUND' ? 404 : 400).send({
            error: error.code,
            message: error.message,
          });
        }

        return reply.code(500).send({ error: 'Internal Server Error', message: 'Errore durante upload immagine' });
      }
    }
  );

}
