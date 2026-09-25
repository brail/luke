/**
 * Raw Fastify route for downloading a passphrase-protected, instance-portable backup export
 * package (`.lukebak`). Deliberately not a tRPC procedure and not the generic
 * `/uploads/:bucket/*` proxy: the payload can be many GB, so it must stream (see
 * `streamRawResponse`), and the "backups" bucket is excluded from the generic proxy on purpose.
 * The response body is the export envelope: `encodeExportHeader(payload.header)` followed by the
 * stored ciphertext, unchanged.
 *
 * Authorized via a short-lived signed token (`maintenance.backup.prepareExport` mints it) rather
 * than a Bearer session, since a plain browser navigation can't set an Authorization header; the
 * permission check (`maintenance:backup_export`) already happened when the token was minted.
 */

import { PassThrough, type Readable } from 'stream';

import type { PrismaClient } from '@luke/db';

import { encodeExportHeader } from '../lib/backup/exportFormat';
import { getStorageProvider } from '../storage';
import { verifyExportToken } from '../utils/downloadToken';
import { streamRawResponse } from '../utils/streamResponse';

import type { FastifyInstance } from 'fastify';

export async function registerBackupExportDownloadRoute(
  fastify: FastifyInstance,
  prisma: PrismaClient
): Promise<void> {
  fastify.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/download/backup/:id/export',
    async (request, reply) => {
      let payload;
      try {
        payload = verifyExportToken(request.query.token ?? '');
      } catch {
        reply.code(401).send({ error: 'Unauthorized', message: 'Link di export non valido o scaduto' });
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
        const { stream } = await provider.get({ bucket: 'backups', key: record.filename });

        const combined = new PassThrough();
        combined.write(encodeExportHeader(payload.header));
        (stream as Readable).on('error', err => combined.destroy(err));
        (stream as Readable).pipe(combined);

        streamRawResponse(
          reply,
          combined,
          {
            'Content-Type': 'application/octet-stream',
            // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- Content-Disposition:attachment forces download; Content-Type is a fixed constant, not sniffed from the client
            'Content-Disposition': `attachment; filename="${record.id}.lukebak"`,
            'Cache-Control': 'private, no-store',
          },
          err => fastify.log.error({ err, backupId: record.id }, 'Backup export stream failed')
        );
      } catch (err) {
        fastify.log.error({ err, backupId: record.id }, 'Backup export failed');
        reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  );
}
