/**
 * Fastify plugin for collection layout row picture upload.
 *
 * Endpoints:
 *  - POST /upload/collection-row-picture/temp     — temporary upload for row creation (no row ID yet)
 *  - POST /upload/collection-row-picture/:rowId   — upload for an existing row (validates row exists)
 *
 * Both endpoints require authentication and the `collection_layout:update` permission; the
 * row endpoint also requires brand scope on the row's layout.
 * The file is stored and its key returned immediately; the key is persisted to the DB
 * only when the containing form is saved via `tRPC collectionLayout.rows.create/update`.
 */

import rateLimit from '@fastify/rate-limit';

import { isDevelopment } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { rateLimitKeyFromRequest, requireSessionWithPermission } from '../lib/auth';
import { getTraceId } from '../lib/error';
import { readUploadFile, sendUploadError } from '../lib/multipartUpload';
import { uploadCollectionRowPicture, uploadTempCollectionRowPicture } from '../services/collectionRowPicture.service';

import type { FastifyInstance } from 'fastify';


export default async function collectionRowPictureRoutes(
  app: FastifyInstance,
  options: { prisma: PrismaClient }
) {
  await app.register(rateLimit, {
    max: isDevelopment() ? 100 : 30,
    timeWindow: '1 minute',
    keyGenerator: rateLimitKeyFromRequest,
  });

  // Temp endpoint — no row ID required (create mode)
  // Registered before /:rowId so the literal "temp" path takes precedence.
  app.post('/upload/collection-row-picture/temp', async (req, reply) => {
    const session = await requireSessionWithPermission(req, reply, 'collection_layout:update', options.prisma);
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
      const file = await readUploadFile(req, 'collection-row-picture');

      const result = await uploadTempCollectionRowPicture(ctx, { file });

      return reply.code(200).send(result);
    } catch (error: unknown) {
      return sendUploadError(req, reply, error, { log: 'Temp collection row picture upload error', message: 'Errore durante upload foto' });
    }
  });

  app.post<{
    Params: { rowId: string };
  }>('/upload/collection-row-picture/:rowId', async (req, reply) => {
    const session = await requireSessionWithPermission(req, reply, 'collection_layout:update', options.prisma);
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
      const file = await readUploadFile(req, 'collection-row-picture');

      const result = await uploadCollectionRowPicture(ctx, { rowId: req.params.rowId, file });

      return reply.code(200).send(result);
    } catch (error: unknown) {
      return sendUploadError(req, reply, error, { log: 'Collection row picture upload error', message: 'Errore durante upload foto' });
    }
  });
}
