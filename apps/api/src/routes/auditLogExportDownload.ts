/**
 * Raw Fastify route for streaming the audit log as CSV.
 *
 * Same rationale as `backupDownload.ts`: not a tRPC procedure, so the browser can download via
 * a native `<a href>` instead of buffering into a JS `Blob`. Authorized via a short-lived signed
 * token (`auditLog.getExportLink` mints it after checking `audit:read_all`) rather than a Bearer
 * session — the token encodes the filters applied on the audit log page, not a stored file
 * bucket/key, since the CSV is generated on the fly from the database rather than read from
 * storage.
 */

import { Readable } from 'stream';

import { getAuditActionLabel } from '@luke/core';

import { auditActorName, buildAuditLogWhere } from '../lib/auditLog';
import { verifyAuditLogExportToken } from '../utils/downloadToken';
import { streamRawResponse } from '../utils/streamResponse';

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

const EXPORT_BATCH_SIZE = 500;

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Streams the CSV in batches rather than loading the whole audit trail into memory at once. */
async function* generateAuditLogCsv(prisma: PrismaClient, filters: Parameters<typeof buildAuditLogWhere>[0]) {
  // Leading BOM (explicit escape, not a literal character, so it doesn't trip no-irregular-whitespace):
  // makes Excel recognize UTF-8, otherwise it mangles accented characters.
  const BOM = '\uFEFF';
  yield `${BOM}${['Data/Ora', 'Autore', 'Email', 'Azione', 'Entità', 'ID Entità', 'Esito', 'IP'].join(',')}\n`;

  const whereClause = buildAuditLogWhere(filters);
  let skip = 0;
  for (;;) {
    const batch = await prisma.auditLog.findMany({
      where: whereClause,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take: EXPORT_BATCH_SIZE,
      include: { actor: { select: { firstName: true, lastName: true, username: true, email: true } } },
    });
    if (batch.length === 0) break;

    for (const entry of batch) {
      const row = [
        entry.createdAt.toISOString(),
        auditActorName(entry.actor) ?? '',
        entry.actor?.email ?? '',
        getAuditActionLabel(entry.action),
        entry.targetType,
        entry.targetId ?? '',
        entry.result,
        entry.ip ?? '',
      ];
      yield `${row.map(csvEscape).join(',')}\n`;
    }

    if (batch.length < EXPORT_BATCH_SIZE) break;
    skip += EXPORT_BATCH_SIZE;
  }
}

export async function registerAuditLogExportDownloadRoute(
  fastify: FastifyInstance,
  prisma: PrismaClient
): Promise<void> {
  fastify.get<{ Querystring: { token?: string } }>(
    '/maintenance/audit-log/export',
    async (request, reply) => {
      let payload;
      try {
        payload = verifyAuditLogExportToken(request.query.token ?? '');
      } catch {
        reply.code(401).send({ error: 'Unauthorized', message: 'Link di export non valido o scaduto' });
        return;
      }

      const csvStream = Readable.from(generateAuditLogCsv(prisma, payload.filters));

      streamRawResponse(
        reply,
        csvStream,
        {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'private, no-store',
        },
        err => fastify.log.error({ err }, 'Audit log export stream failed')
      );
    }
  );
}
