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
 * Accepted MIME types: image/png, image/jpeg, image/webp. Max size: `ASSET_KINDS['brand-logo']`.
 * Writes are delegated to the storage service and produce an audit log entry.
 */

import rateLimit from '@fastify/rate-limit';

import { isDevelopment } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { rateLimitKeyFromRequest, requireSessionWithPermission } from '../lib/auth';
import { getTraceId } from '../lib/error';
import { noFileError, readUploadFile, sendUploadError, toUploadFile, uploadLimits, type UploadFile } from '../lib/multipartUpload';
import {
  uploadBrandLogo,
  uploadTempBrandLogo,
} from '../services/brandLogo.service';

import type { FastifyInstance } from 'fastify';

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
      const file = await readUploadFile(req, 'brand-logo');

      const result = await uploadBrandLogo(ctx, { brandId: req.params.brandId, file });

      return reply.code(200).send(result);
    } catch (error: unknown) {
      return sendUploadError(req, reply, error, { log: 'Brand logo upload error', message: 'Errore durante upload logo' });
    }
  });

  // Endpoint for temporary upload during brand creation
  app.post('/upload/brand-logo/temp', async (req, reply) => {
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
      let file: UploadFile | null = null;

      for await (const part of req.parts({ limits: uploadLimits('brand-logo') })) {
        if (part.type === 'file') {
          file = await toUploadFile(part, 'brand-logo');
        }
      }

      if (!file) throw noFileError();

      const result = await uploadTempBrandLogo(ctx, { file });

      return reply.code(200).send(result);
    } catch (error: unknown) {
      return sendUploadError(req, reply, error, { log: 'Temp brand logo upload error', message: 'Errore durante upload temporaneo logo' });
    }
  });
}
