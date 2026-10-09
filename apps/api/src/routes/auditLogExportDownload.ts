/**
 * Raw Fastify route for streaming the audit log export, as CSV or XLSX (`format` query parameter).
 *
 * Same rationale as `backupExportDownload.ts`: not a tRPC procedure, so the browser can download via
 * a native `<a href>` instead of buffering into a JS `Blob`. Authorized via a short-lived signed
 * token (`auditLog.getExportLink` mints it after checking `audit:read_all`) rather than a Bearer
 * session — the token encodes the filters applied on the audit log page, not a stored file
 * bucket/key, since the export is generated on the fly from the database rather than read from
 * storage.
 */

import { PassThrough, Readable } from 'stream';

import {
  AuditLogExportFormatSchema,
  getAuditActionLabel,
  type AuditLogExportFormat,
  type AuditLogFilters,
} from '@luke/core';
import type { PrismaClient } from '@luke/db';

import { auditActorName, auditSubjectOf, buildAuditLogWhere, resolveAuditSubjects } from '../lib/auditLog';
import { applyStreamingHeaderStyle, createStreamingWorkbook } from '../lib/export/xlsxStreaming';
import { verifyAuditLogExportToken } from '../utils/downloadToken';
import { streamRawResponse } from '../utils/streamResponse';

import type { FastifyInstance } from 'fastify';

const EXPORT_BATCH_SIZE = 500;
const EXPORT_COLUMNS = ['Data/Ora', 'Autore', 'Email', 'Attribuzione', 'Azione', 'Entità', 'ID Entità', 'Esito', 'IP'];
const CONTENT_TYPES: Record<AuditLogExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

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

/** Yields one row of `EXPORT_COLUMNS` per event, read in batches rather than the whole audit trail at once. */
async function* auditLogRows(prisma: PrismaClient, filters: AuditLogFilters): AsyncGenerator<string[]> {
  const whereClause = buildAuditLogWhere(filters);
  // Keyset, not offset: each batch starts after the last row read, so events written at the top or
  // rows retention deletes at the bottom while a long export runs neither repeat nor skip a row.
  let last: { createdAt: Date; id: string } | undefined;
  for (;;) {
    const after = last && {
      OR: [{ createdAt: { lt: last.createdAt } }, { createdAt: last.createdAt, id: { lt: last.id } }],
    };
    const batch = await prisma.auditLog.findMany({
      where: after ? { AND: [whereClause, after] } : whereClause,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EXPORT_BATCH_SIZE,
      include: { actor: { select: { firstName: true, lastName: true, username: true, email: true } } },
    });
    if (batch.length === 0) break;

    const subjects = await resolveAuditSubjects(prisma, batch);

    for (const entry of batch) {
      // Pre-session events (login, email verification, password reset) carry no actor but do
      // identify their subject. Both land in the same columns so the export stays one shape;
      // `Attribuzione` is what tells an auditor whether the identity is a proven actor or an
      // inferred subject.
      const subject = auditSubjectOf(entry, subjects);
      const attribution = entry.actorId ? 'utente' : subject.name ? 'soggetto' : 'sistema';
      yield [
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
    }

    if (batch.length < EXPORT_BATCH_SIZE) break;
    last = batch.at(-1);
  }
}

/** Streams the export as CSV. */
export async function* generateAuditLogCsv(prisma: PrismaClient, filters: AuditLogFilters) {
  // Leading BOM (explicit escape, not a literal character, so it doesn't trip no-irregular-whitespace):
  // makes Excel recognize UTF-8, otherwise it mangles accented characters.
  const BOM = '\uFEFF';
  yield `${BOM}${EXPORT_COLUMNS.join(',')}\n`;
  for await (const row of auditLogRows(prisma, filters)) yield `${row.map(csvEscape).join(',')}\n`;
}

/** Resolves once `stream` drains or closes, whichever comes first. */
function drainedOrClosed(stream: PassThrough): Promise<void> {
  return new Promise(resolve => {
    const done = () => {
      stream.off('drain', done).off('close', done);
      resolve();
    };
    stream.on('drain', done).on('close', done);
  });
}

/**
 * Writes the export as XLSX into `out` row by row, so the workbook never sits whole in memory.
 * Cells are strings, which exceljs writes as text and never as a formula: unlike the CSV, no value
 * needs a leading `'`. A row is added only once `out` has room, and none after it closes.
 */
export async function writeAuditLogXlsx(prisma: PrismaClient, filters: AuditLogFilters, out: PassThrough): Promise<void> {
  const workbook = createStreamingWorkbook(out, { title: 'Audit Log' });
  const sheet = workbook.addWorksheet('Audit Log', { views: [{ state: 'frozen', ySplit: 1 }] });
  const header = sheet.addRow(EXPORT_COLUMNS);
  applyStreamingHeaderStyle(header, 'report');
  header.commit();
  for await (const row of auditLogRows(prisma, filters)) {
    if (out.writableNeedDrain) await drainedOrClosed(out);
    if (out.destroyed) return;
    sheet.addRow(row).commit();
  }
  sheet.commit();
  await workbook.commit();
}

export async function registerAuditLogExportDownloadRoute(
  fastify: FastifyInstance,
  prisma: PrismaClient
): Promise<void> {
  fastify.get<{ Querystring: { token?: string; format?: string } }>(
    '/download/audit-log',
    async (request, reply) => {
      let payload;
      try {
        payload = verifyAuditLogExportToken(request.query.token ?? '');
      } catch {
        reply.code(401).send({ error: 'Unauthorized', message: 'Link di export non valido o scaduto' });
        return;
      }

      const format = AuditLogExportFormatSchema.safeParse(request.query.format ?? 'csv');
      if (!format.success) {
        reply.code(400).send({ error: 'Bad Request', message: 'Formato di export non valido' });
        return;
      }

      const xlsx = format.data === 'xlsx' ? new PassThrough() : undefined;
      streamRawResponse(
        reply,
        xlsx ?? Readable.from(generateAuditLogCsv(prisma, payload.filters)),
        {
          'Content-Type': CONTENT_TYPES[format.data],
          'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.${format.data}"`,
          'Cache-Control': 'private, no-store',
        },
        err => fastify.log.error({ err }, 'Audit log export stream failed')
      );
      // The writer's failure reaches the response through the stream's error handler.
      if (xlsx) writeAuditLogXlsx(prisma, payload.filters, xlsx).catch((err: Error) => xlsx.destroy(err));
    }
  );
}
