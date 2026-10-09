/**
 * Every field of the audit log CSV export reaches a spreadsheet as inert text, and a field
 * never splits its row (#93).
 */

import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { csvEscape, generateAuditLogCsv } from '../src/routes/auditLogExportDownload';

describe('csvEscape', () => {
  it('prefixes an apostrophe to a value a spreadsheet would read as a formula', () => {
    expect(csvEscape('=1+1')).toBe(`"'=1+1"`);
    expect(csvEscape('+1')).toBe(`"'+1"`);
    expect(csvEscape('-1')).toBe(`"'-1"`);
    expect(csvEscape('@SUM(A1)')).toBe(`"'@SUM(A1)"`);
    expect(csvEscape('\tx')).toBe(`"'\tx"`);
    expect(csvEscape('\rx')).toBe(`"'\rx"`);
  });

  it('quotes every value and doubles its quotes', () => {
    expect(csvEscape('Mario Rossi')).toBe('"Mario Rossi"');
    expect(csvEscape('a,b;c\r\nd')).toBe('"a,b;c\r\nd"');
    expect(csvEscape('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
    expect(csvEscape('')).toBe('""');
  });

  it('leaves the text of everyday values unchanged', () => {
    for (const value of ['2026-10-09T08:15:00.000Z', 'mario.rossi@example.com', '::ffff:127.0.0.1']) {
      expect(csvEscape(value)).toBe(`"${value}"`);
    }
  });
});

/**
 * Splits one CSV record into its fields on `separator`, honouring RFC 4180 quotes the way a
 * spreadsheet does: a separator between quotes does not split.
 */
function parseRecord(line: string, separator = ','): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === separator) {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

describe('generateAuditLogCsv', () => {
  it('writes one record per event, with no field a spreadsheet would evaluate', async () => {
    const createdAt = new Date('2026-10-09T08:15:00.000Z');
    const events = [
      {
        // A failed login: no actor, the subject is the typed username.
        createdAt, actorId: null, actor: null, action: 'AUTH_LOGIN', targetType: '+User',
        targetId: '-1', result: 'FAILURE', ip: '@ip\rforged',
        metadata: { username: 'x;=1+1' },
      },
      {
        createdAt, actorId: 'u1', action: 'AUTH_LOGIN', targetType: 'User', targetId: 'u1',
        result: 'SUCCESS', ip: '127.0.0.1', metadata: null,
        actor: { firstName: '@Mario', lastName: 'Rossi', username: 'mario', email: '\tmario@example.com' },
      },
    ];
    const findMany = vi.fn().mockResolvedValueOnce(events).mockResolvedValue([]);
    // Only the two calls the generator makes; the rest of the client is never touched.
    const prisma = { auditLog: { findMany }, user: { findMany: async () => [] } } as unknown as PrismaClient;

    let csv = '';
    for await (const chunk of generateAuditLogCsv(prisma, {})) csv += chunk;

    const lines = csv.split('\n').filter(Boolean).slice(1);
    const records = lines.map(line => parseRecord(line));
    expect(records).toHaveLength(events.length);
    for (const fields of records) {
      expect(fields).toHaveLength(9);
      for (const field of fields) expect(field).not.toMatch(/^[=+\-@\t\r]/);
    }
    expect(records[0][1]).toBe('x;=1+1');
    expect(records[0][8]).toBe('\'@ip\rforged');
    // A spreadsheet whose locale splits on `;` keeps each record in one cell, so no part of a
    // value can land at the start of a cell of its own.
    for (const line of lines) expect(parseRecord(line, ';')).toHaveLength(1);
  });
});
