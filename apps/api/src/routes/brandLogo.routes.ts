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
 * Accepted MIME types: image/png, image/jpeg, image/webp. Max size: 2 MB.
 * Writes are delegated to the storage service and produce an audit log entry.
 */

import { Readable } from 'stream';

import rateLimit from '@fastify/rate-limit';

import { isDevelopment } from '@luke/core';

import { rateLimitKeyFromRequest, requireSessionWithPermission } from '../lib/auth';
import {
  uploadBrandLogo,
  uploadTempBrandLogo,
} from '../services/brandLogo.service';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';


/**
 * Codici d'errore di `@fastify/multipart` imputabili al client: body non
 * multipart, troppi file/parti/campi, file oltre il limite, protocollo violato.
 *
 * Senza questa distinzione finivano tutti nel 500 generico, presentando una
 * richiesta malformata come un guasto del server — e nascondendo al client la
 * ragione vera del rifiuto.
 */
const CLIENT_MULTIPART_ERROR_CODES = new Set([
  'FST_INVALID_MULTIPART_CONTENT_TYPE',
  'FST_REQ_FILE_TOO_LARGE',
  'FST_FILES_LIMIT',
  'FST_PARTS_LIMIT',
  'FST_FIELDS_LIMIT',
  'FST_PROTO_VIOLATION',
]);

function isClientMultipartError(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string' && CLIENT_MULTIPART_ERROR_CODES.has(code)) {
    return true;
  }

  // busboy (il parser sotto @fastify/multipart) segnala i body malformati —
  // "Multipart: Boundary not found" e simili — con un Error privo di `code`.
  // Resta un errore del client: senza questo controllo un body corrotto
  // risultava indistinguibile da un guasto interno.
  const message = (error as { message?: unknown })?.message;
  return typeof message === 'string' && message.startsWith('Multipart: ');
}

/**
 * Volutamente NON wrappato in `fastify-plugin`: l'incapsulamento è ciò che tiene
 * il rate limiter qui sotto confinato a queste due rotte. Con `fp()` il limiter
 * finiva nello scope root e diventava il limite globale del server — 30 req/min
 * per utente su ogni rotta in produzione, batch tRPC inclusi, al posto dei 100
 * per IP configurati in `server.ts`. Stesso motivo per cui `specsheetImage` e
 * `collectionRowPicture` sono funzioni async semplici.
 */
export default async function brandLogoRoutes(
  app: FastifyInstance,
  options: { prisma: PrismaClient }
) {
  // Rate limiting per utente autenticato (con fallback a IP se non autenticato)
  await app.register(rateLimit, {
    max: isDevelopment() ? 100 : 30, // 30 req/min in prod per utente
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
      traceId: (req as any).traceId || 'unknown',
      req,
      res: reply,
      logger: req.log,
    };

    try {
      // Ricevi file multipart
      const data = await req.file();
      if (!data) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Nessun file ricevuto',
        });
      }

      // Consuma correttamente lo stream multipart
      const chunks: Buffer[] = [];
      for await (const chunk of data.file) {
        chunks.push(chunk as Buffer);
      }
      const buffer = Buffer.concat(chunks);

      // Upload tramite service
      const result = await uploadBrandLogo(ctx, {
        brandId: req.params.brandId,
        file: {
          filename: data.filename,
          mimetype: data.mimetype,
          stream: Readable.from(buffer),
          size: buffer.length,
        },
      });

      return reply.code(200).send(result);
    } catch (error: any) {
      req.log.error(
        { error: error.message, brandId: req.params.brandId },
        'Brand logo upload error'
      );

      if (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND') {
        return reply.code(error.code === 'NOT_FOUND' ? 404 : 400).send({
          error: error.code,
          message: error.message,
        });
      }

      if (isClientMultipartError(error)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: error.message,
        });
      }

      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Errore durante upload logo',
      });
    }
  });

  // Endpoint per upload temporaneo durante creazione brand
  app.post<{
    Body: { tempId: string };
  }>('/upload/brand-logo/temp', async (req, reply) => {
    const session = await requireSessionWithPermission(req, reply, 'brands:create', options.prisma);
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
      let fileBuffer: Buffer | null = null;
      let filename = 'upload';
      let mimetype = 'application/octet-stream';

      for await (const part of req.parts()) {
        if (part.type === 'file') {
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
        return reply.code(400).send({
          error: 'Bad Request',
          message: 'Nessun file ricevuto',
        });
      }

      // Upload pending tramite service
      const result = await uploadTempBrandLogo(ctx, {
        file: {
          filename,
          mimetype,
          stream: Readable.from(fileBuffer),
          size: fileBuffer.length,
        },
      });

      return reply.code(200).send(result);
    } catch (error: any) {
      req.log.error(
        { error: error.message, tempId: (req.body as any)?.tempId },
        'Temp brand logo upload error'
      );

      if (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND') {
        return reply.code(error.code === 'NOT_FOUND' ? 404 : 400).send({
          error: error.code,
          message: error.message,
        });
      }

      if (isClientMultipartError(error)) {
        return reply.code(400).send({
          error: 'Bad Request',
          message: error.message,
        });
      }

      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Errore durante upload temporaneo logo',
      });
    }
  });
}
