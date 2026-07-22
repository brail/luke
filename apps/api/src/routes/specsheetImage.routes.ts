/**
 * Fastify plugin for merchandising specsheet image upload.
 *
 * Endpoint: POST /upload/specsheet-image/:specsheetId
 *
 * Requires authentication and the `merchandising_plan:update` permission.
 * Rate-limited to 30 req/min per user (100 in development). Max file size: 10 MB.
 * Accepted MIME types: image/png, image/jpeg, image/webp.
 * An optional `caption` field may be included in the multipart form data.
 */

import rateLimit from '@fastify/rate-limit';


import { isDevelopment } from '@luke/core';

import { requireSessionWithPermission } from '../lib/auth';
import { uploadSpecsheetImage } from '../services/specsheetImage.service';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

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
      const session = await requireSessionWithPermission(req, reply, 'merchandising_plan:update');
      if (!session) return;

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
