/**
 * Raw Fastify route for streaming the audit log as CSV.
 *
 * Same rationale as `backupExportDownload.ts`: not a tRPC procedure, so the browser can download via
 * a native `<a href>` instead of buffering into a JS `Blob`. Authorized via a short-lived signed
 * token (`auditLog.getExportLink` mints it after checking `audit:read_all`) rather than a Bearer
 * session — the token encodes the filters applied on the audit log page, not a stored file
 * bucket/key, since the CSV is generated on the fly from the database rather than read from
 * storage.
 */

import { Readable } from 'stream';

import { getAuditActionLabel } from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { auditActorName, auditSubjectOf, buildAuditLogWhere, resolveAuditSubjects } from '../lib/auditLog';
import { verifyAuditLogExportToken } from '../utils/downloadToken';
import { streamRawResponse } from '../utils/streamResponse';

import type { FastifyInstance } from 'fastify';

const EXPORT_BATCH_SIZE = 500;

/**
 * One CSV field, always quoted. A value starting with `=`, `+`, `-`, `@`, a tab or a carriage
 * return gets a leading `'`, so a spreadsheet shows it as text instead of evaluating it
 * (CWE-1236); no column of this export is numeric, so the prefix never hides a number. The
 * quotes keep every separator and line break inside the field, `;` included: a spreadsheet
 * whose locale splits on `;` cannot cut a value into a cell that starts a formula.
 */
export function csvEscape(value: string): string {
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Streams the CSV in batches rather than loading the whole audit trail into memory at once. */
export async function* generateAuditLogCsv(prisma: PrismaClient, filters: Parameters<typeof buildAuditLogWhere>[0]) {
  // Leading BOM (explicit escape, not a literal character, so it doesn't trip no-irregular-whitespace):
  // makes Excel recognize UTF-8, otherwise it mangles accented characters.
  const BOM = '\uFEFF';
  yield `${BOM}${['Data/Ora', 'Autore', 'Email', 'Attribuzione', 'Azione', 'Entità', 'ID Entità', 'Esito', 'IP'].join(',')}\n`;

  const whereClause = buildAuditLogWhere(filters);
  // Keyset, not offset: each batch starts after the last row read, so events written at the top or
  // rows retention deletes at the bottom while a long export runs neither repeat nor skip a row.
  let last: { createdAt: Date; id: string } | undefined;
  for (;;) {
    const batch = await prisma.auditLog.findMany({
      where: last
        ? {
            AND: [
              whereClause,
              { OR: [{ createdAt: { lt: last.createdAt } }, { createdAt: last.createdAt, id: { lt: last.id } }] },
            ],
          }
        : whereClause,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_BATCH_SIZE,
      include: { actor: { select: { firstName: true, lastName: true, username: true, email: true } } },
    });
    if (batch.length === 0) break;

    const subjects = await resolveAuditSubjects(prisma, batch);

    for (const entry of batch) {
      // Pre-session events (login, email verification, password reset) carry no actor but do
      // identify their subject. Both land in the same columns so the CSV stays one shape;
      // `Attribuzione` is what tells an auditor whether the identity is a proven actor or an
      // inferred subject.
      const subject = auditSubjectOf(entry, subjects);
      const attribution = entry.actorId ? 'utente' : subject.name ? 'soggetto' : 'sistema';
      const row = [
        entry.createdAt.toISOString(),
        auditActorName(entry.actor) ?? subject.name ?? '',
        entry.actor?.email ?? subject.email ?? '',
        attribution,
        getAuditActionLabel(entry.action),
        entry.targetType,
        entry.targetId ?? '',
        entry.result,
        entry.ip ?? '',
      ];
      yield `${row.map(csvEscape).join(',')}\n`;
    }

    if (batch.length < EXPORT_BATCH_SIZE) break;
    last = batch.at(-1);
  }
}

export async function registerAuditLogExportDownloadRoute(
  fastify: FastifyInstance,
  prisma: PrismaClient
): Promise<void> {
  fastify.get<{ Querystring: { token?: string } }>(
    '/download/audit-log',
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
