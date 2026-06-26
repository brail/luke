import fp from 'fastify-plugin';
import { hasPermission, type Role } from '@luke/core';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';

import { authenticateRequest } from '../lib/auth.js';
import { uploadCompanyLogo } from '../services/companyLogo.service.js';

export default fp(
  async (app: FastifyInstance, options: { prisma: PrismaClient }) => {
    app.post('/upload/company-logo', async (req, reply) => {
      const session = await authenticateRequest(req, reply);
      if (!session) {
        return reply.code(401).send({ error: 'Unauthorized', message: 'Autenticazione richiesta' });
      }

      if (!hasPermission(session.user as { role: Role }, 'company_profile:update')) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Permesso negato: richiesta company_profile:update' });
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

        const result = await uploadCompanyLogo(ctx, {
          file: {
            filename: data.filename,
            mimetype: data.mimetype,
            stream: require('stream').Readable.from(buffer),
            size: buffer.length,
          },
        });

        return reply.code(200).send(result);
      } catch (error: any) {
        req.log.error({ error: error.message }, 'Company logo upload error');

        if (error.code === 'BAD_REQUEST' || error.code === 'NOT_FOUND') {
          return reply.code(error.code === 'NOT_FOUND' ? 404 : 400).send({
            error: error.code,
            message: error.message,
          });
        }

        return reply.code(500).send({ error: 'Internal Server Error', message: 'Errore durante upload logo' });
      }
    });
  },
  { name: 'company-logo-routes', dependencies: ['@fastify/multipart'] }
);
