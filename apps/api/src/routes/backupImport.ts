/**
 * Raw Fastify route for importing a passphrase-protected, instance-portable backup export
 * package (`.lukebak`) — the counterpart to `backupExportDownload.ts`. Lets an admin restore a
 * backup that was downloaded from this instance (or a different one entirely), as long as they
 * know the export passphrase.
 *
 * Unlike download/export (authorized via a short-lived signed token), this writes data and must
 * be gated by a real session + permission check — `requireSessionWithPermission` (the pattern
 * used by other raw upload routes that can't go through tRPC's request/response cycle).
 *
 * The route itself stays thin (auth + multipart parsing + audit log); the actual import logic
 * lives in the pure `runImportJob` engine (`lib/backup/importPipeline.ts`), same split as
 * `dumpPipeline.ts`/`restorePipeline.ts`.
 */

import { BackupImportFieldsSchema } from '@luke/core';

import { logAudit } from '../lib/auditLog';
import { requireSessionWithPermission } from '../lib/auth';
import { BackupImportValidationError, runImportJob } from '../lib/backup/importPipeline';

import type { Context } from '../lib/trpc';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

/** Safely extracts the string `.value` from a parsed @fastify/multipart form field. */
function getMultipartFieldValue(field: unknown): string | undefined {
  if (field && typeof field === 'object' && !Array.isArray(field) && 'value' in field) {
    const value = (field as { value: unknown }).value;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

export async function registerBackupImportRoute(
  fastify: FastifyInstance,
  prisma: PrismaClient
): Promise<void> {
  fastify.post('/maintenance/backup/import', async (request, reply) => {
    const session = await requireSessionWithPermission(request, reply, 'maintenance:backup_restore', prisma);
    if (!session) return;

    const data = await request.file({ limits: { fileSize: Number.MAX_SAFE_INTEGER, files: 1 } });
    if (!data) {
      reply.code(400).send({ error: 'Bad Request', message: 'File mancante' });
      return;
    }

    const parsedFields = BackupImportFieldsSchema.safeParse({
      passphrase: getMultipartFieldValue(data.fields.passphrase),
      label: getMultipartFieldValue(data.fields.label) || undefined,
    });
    if (!parsedFields.success) {
      reply.code(400).send({
        error: 'Bad Request',
        message: parsedFields.error.issues[0]?.message ?? 'Campi non validi',
      });
      return;
    }

    try {
      const { id, scope } = await runImportJob({
        prisma,
        fileStream: data.file,
        passphrase: parsedFields.data.passphrase,
        label: parsedFields.data.label,
        createdById: session.user.id,
      });

      const ctx: Context = {
        session,
        prisma,
        traceId: (request as { traceId?: string }).traceId || 'unknown',
        req: request,
        res: reply,
        logger: request.log,
      };
      await logAudit(ctx, {
        action: 'BACKUP_IMPORT',
        targetType: 'BackupRecord',
        targetId: id,
        result: 'SUCCESS',
        metadata: { scope },
      });

      reply.send({ id });
    } catch (err) {
      if (err instanceof BackupImportValidationError) {
        reply.code(400).send({ error: 'Bad Request', message: err.message });
        return;
      }
      fastify.log.error({ err }, 'Backup import failed');
      reply.code(500).send({ error: 'Internal Server Error', message: 'Import fallito' });
    }
  });
}
