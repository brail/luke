/**
 * Plugin Fastify per upload logo Brand
 * Endpoint: POST /upload/brand-logo/:brandId
 *
 * Features:
 * - Autenticazione richiesta
 * - Rate limiting: 10 req/min per IP
 * - Validazione MIME: png, jpeg, webp
 * - Size limit: 2MB
 * - Upload tramite storage service
 * - Aggiornamento Brand.logoUrl
 * - Audit log
 */

import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import {
  uploadBrandLogo,
  uploadTempBrandLogo,
} from '../services/brandLogo.service';
import { authenticateRequest } from '../lib/auth';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

export default fp(
  async (app: FastifyInstance, options: { prisma: PrismaClient }) => {
    // Registra multipart plugin con limiti
    await app.register(multipart, {
      limits: {
        fileSize: 2 * 1024 * 1024, // 2MB
        files: 1, // Un solo file per volta
      },
    });

    // Rate limiting scoped solo per upload - più permissivo in dev
    await app.register(rateLimit, {
      max: process.env.NODE_ENV === 'development' ? 100 : 10,
      timeWindow: '1 minute',
      keyGenerator: req => req.ip,
    });

    app.post<{
      Params: { brandId: string };
    }>('/upload/brand-logo/:brandId', async (req, reply) => {
      // Autenticazione
      const session = await authenticateRequest(req, reply);
      if (!session) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Autenticazione richiesta',
        });
      }

      // Context per service layer
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
            stream: require('stream').Readable.from(buffer),
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
      // Autenticazione
      const session = await authenticateRequest(req, reply);
      if (!session) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Autenticazione richiesta',
        });
      }

      // Context per service layer
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

        // Ricevi tempId dal FormData
        const tempIdField = data.fields?.tempId;
        if (!tempIdField || typeof tempIdField !== 'string') {
          return reply.code(400).send({
            error: 'Bad Request',
            message: 'tempId richiesto',
          });
        }
        const tempId = tempIdField;

        // Consuma correttamente lo stream multipart
        const chunks: Buffer[] = [];
        for await (const chunk of data.file) {
          chunks.push(chunk as Buffer);
        }
        const buffer = Buffer.concat(chunks);

        // Upload temporaneo tramite service
        const result = await uploadTempBrandLogo(ctx, {
          tempId,
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
          { error: error.message, tempId: (req.body as any)?.tempId },
          'Temp brand logo upload error'
        );

        if (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND') {
          return reply.code(error.code === 'NOT_FOUND' ? 404 : 400).send({
            error: error.code,
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
);
