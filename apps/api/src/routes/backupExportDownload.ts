/**
 * Raw Fastify route for downloading a passphrase-protected, instance-portable backup export
 * package (`.lukebak`). Same streaming rationale as `backupDownload.ts` (payload can be many
 * GB) — the only difference is the response body is the export envelope (header + original
 * ciphertext), built by prepending `encodeExportHeader(payload.header)` to the same blob stream
 * `backupDownload.ts` sends unchanged.
 *
 * Authorized the same way as `backupDownload.ts`: a short-lived signed token
 * (`maintenance.backup.prepareExport` mints it) rather than a Bearer session — the permission
 * check (`maintenance:backup_export`) already happened when the token was minted.
 */

import { PassThrough, type Readable } from 'stream';

import { encodeExportHeader } from '../lib/backup/exportFormat';
import { getStorageProvider } from '../storage';
import { verifyExportToken } from '../utils/downloadToken';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

export async function registerBackupExportDownloadRoute(
  fastify: FastifyInstance,
  prisma: PrismaClient
): Promise<void> {
  fastify.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    '/maintenance/backup/:id/export',
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

        // reply.send(stream) silently truncates large streamed payloads under this Fastify
        // version (empty body, "stream closed prematurely" logged) — same issue and same fix
        // as backupDownload.ts: bypass Fastify's reply pipeline via `hijack()` + the raw Node
        // response.
        reply.hijack();
        reply.raw.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write -- Content-Disposition:attachment forces download; Content-Type is a fixed constant, not sniffed from the client
          'Content-Disposition': `attachment; filename="${record.id}.lukebak"`,
          'Cache-Control': 'private, no-store',
        });
        combined.on('error', err => {
          fastify.log.error({ err, backupId: record.id }, 'Backup export stream failed');
          reply.raw.destroy();
        });
        combined.pipe(reply.raw);
      } catch (err) {
        fastify.log.error({ err, backupId: record.id }, 'Backup export failed');
        reply.code(500).send({ error: 'Internal Server Error' });
      }
    }
  );
}
