/**
 * Raw Fastify route for downloading an encrypted backup blob.
 *
 * Deliberately NOT a tRPC procedure and NOT the generic `/uploads/:bucket/*` proxy: the payload
 * can be many GB, so it must stream (`reply.send(stream)`), and the "backups" bucket is excluded
 * from the generic proxy on purpose (see storage-upload.ts).
 *
 * Authorized via a short-lived signed token (`maintenance.backup.getDownloadLink` mints it,
 * same `downloadToken.ts` HMAC primitive as `/storage/download`) rather than a Bearer session —
 * a plain browser navigation/`<a href>` can't set an Authorization header, and the point of this
 * change is to let the frontend download natively instead of buffering the whole blob into a JS
 * `Blob` first. The permission check (`maintenance:read`) already happened when the token was
 * minted; possession of a valid, narrowly-scoped, 5-minute token is the authorization here.
 */

import { getStorageProvider } from '../storage';
import { verifyDownloadToken } from '../utils/downloadToken';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

export async function registerBackupDownloadRoute(
  fastify: FastifyInstance,
  prisma: PrismaClient
): Promise<void> {
  fastify.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/maintenance/backup/:id/download',
    async (request, reply) => {
      let payload;
      try {
        payload = verifyDownloadToken(request.query.token ?? '');
      } catch {
        reply.code(401).send({ error: 'Unauthorized', message: 'Link di download non valido o scaduto' });
        return;
      }
      if (payload.bucket !== 'backups') {
        reply.code(403).send({ error: 'Forbidden' });
        return;
      }

      const record = await prisma.backupRecord.findUnique({ where: { id: request.params.id } });
      if (!record || record.status !== 'COMPLETED' || record.filename !== payload.key) {
        reply.code(404).send({ error: 'Not Found' });
        return;
      }

      try {
        const provider = await getStorageProvider(prisma);
        const { stream, size } = await provider.get({ bucket: 'backups', key: record.filename });

        reply.header('Content-Type', 'application/octet-stream');
        reply.header('Content-Length', size);
        reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(record.filename)}"`);
        reply.header('Cache-Control', 'private, no-store');

        // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- Content-Disposition:attachment forces download; Content-Type is a fixed constant, not sniffed from the client
        reply.send(stream);
      } catch (err) {
        fastify.log.error({ err, backupId: record.id }, 'Backup download failed');
        reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  );
}
