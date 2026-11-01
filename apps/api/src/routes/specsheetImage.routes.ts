/**
 * Fastify plugin for merchandising specsheet image upload.
 *
 * Endpoint: POST /upload/specsheet-image/:specsheetId
 *
 * Requires authentication, the `merchandising_plan:update` permission and brand scope on the
 * specsheet's plan.
 * Rate-limited to 30 req/min per user (100 in development). Max file size: `ASSET_KINDS['specsheet-image']`.
 * Accepted MIME types: image/png, image/jpeg, image/webp.
 * An optional `caption` field may be included in the multipart form data.
 */

import rateLimit from '@fastify/rate-limit';
import { TRPCError } from '@trpc/server';

import { isDevelopment } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { rateLimitKeyFromRequest, requireSessionWithPermission } from '../lib/auth';
import { getTraceId } from '../lib/error';
import { noFileError, sendUploadError, toUploadFile, uploadLimits, type UploadFile } from '../lib/multipartUpload';
import { uploadSpecsheetImage } from '../services/specsheetImage.service';

import type { FastifyInstance } from 'fastify';

const MAX_CAPTION_BYTES = 2048;

export default async function specsheetImageRoutes(
  app: FastifyInstance,
  options: { prisma: PrismaClient }
) {
  await app.register(rateLimit, {
    max: isDevelopment() ? 100 : 30,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyFromRequest,
  });

  app.post<{ Params: { specsheetId: string } }>(
    '/upload/specsheet-image/:specsheetId',
    async (req, reply) => {
      const session = await requireSessionWithPermission(req, reply, 'merchandising_plan:update', options.prisma);
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
        const parts = req.parts({
          limits: { ...uploadLimits('specsheet-image'), fields: 1, parts: 2, fieldSize: MAX_CAPTION_BYTES },
        });
        let file: UploadFile | null = null;
        let caption: string | undefined;
        let captionTooLong = false;

        for await (const part of parts) {
          if (part.type === 'file') {
            file = await toUploadFile(part, 'specsheet-image');
          } else if (part.fieldname === 'caption') {
            // A field over `fieldSize` arrives cut, not refused. Answered after the loop, which
            // reads the rest of the body: a route that stops here leaves the client's send stalled.
            captionTooLong = part.valueTruncated;
            caption = String(part.value);
          }
        }

        if (captionTooLong) throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE', message: 'Didascalia troppo lunga' });

        if (!file) throw noFileError();

        const result = await uploadSpecsheetImage(ctx, { specsheetId: req.params.specsheetId, caption, file });

        return reply.code(200).send(result);
      } catch (error: unknown) {
        return sendUploadError(req, reply, error, { log: 'Specsheet image upload error', message: 'Errore durante upload immagine' });
      }
    }
  );

}
