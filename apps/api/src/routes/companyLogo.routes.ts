/**
 * Fastify plugin for company logo upload.
 *
 * Endpoint: POST /upload/company-logo
 *
 * Requires authentication and the `company_profile:update` permission.
 * Delegates to the company logo service, which validates MIME type and stores the
 * file as **pending**. It does not touch the
 * CompanyProfile: the linking happens in `company.profile.update`, passing
 * the `fileObjectId` that this route returns.
 */

import fp from 'fastify-plugin';

import type { PrismaClient } from '@luke/db';

import { requireSessionWithPermission } from '../lib/auth.js';
import { getTraceId } from '../lib/error.js';
import { readUploadFile, sendUploadError } from '../lib/multipartUpload.js';
import { uploadCompanyLogo } from '../services/companyLogo.service.js';

import type { FastifyInstance } from 'fastify';

export default fp(
  async (app: FastifyInstance, options: { prisma: PrismaClient }) => {
    app.post('/upload/company-logo', async (req, reply) => {
      const session = await requireSessionWithPermission(req, reply, 'company_profile:update', options.prisma);
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
        const file = await readUploadFile(req, 'company-asset');

        const result = await uploadCompanyLogo(ctx, { file });

        return reply.code(200).send(result);
      } catch (error: unknown) {
        return sendUploadError(req, reply, error, { log: 'Company logo upload error', message: 'Errore durante upload logo' });
      }
    });
  },
  { name: 'company-logo-routes', dependencies: ['@fastify/multipart'] }
);
