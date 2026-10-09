/**
 * Every field of the audit log CSV export reaches a spreadsheet as inert text, and a field
 * never splits its row (#93).
 */

import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { csvEscape, generateAuditLogCsv } from '../src/routes/auditLogExportDownload';

describe('csvEscape', () => {
  it('prefixes an apostrophe to a value a spreadsheet would read as a formula', () => {
    expect(csvEscape('=1+1')).toBe("'=1+1");
    expect(csvEscape('+1')).toBe("'+1");
    expect(csvEscape('-1')).toBe("'-1");
    expect(csvEscape('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvEscape('\tx')).toBe("'\tx");
  });

  it('quotes a value with a carriage return, so it stays one field', () => {
    expect(csvEscape('a\rb')).toBe('"a\rb"');
    expect(csvEscape('\rx')).toBe('"\'\rx"');
  });

  it('quotes a value with a comma, a quote or a newline, doubling the quotes', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('a\nb')).toBe('"a\nb"');
    expect(csvEscape('=HYPERLINK("x","y")')).toBe('"\'=HYPERLINK(""x"",""y"")"');
  });

  it('leaves the values the export writes every day as they are', () => {
    expect(csvEscape('2026-10-09T08:15:00.000Z')).toBe('2026-10-09T08:15:00.000Z');
    expect(csvEscape('Mario Rossi')).toBe('Mario Rossi');
    expect(csvEscape('mario.rossi@example.com')).toBe('mario.rossi@example.com');
    expect(csvEscape('::ffff:127.0.0.1')).toBe('::ffff:127.0.0.1');
    expect(csvEscape('')).toBe('');
  });
});

/** Splits one CSV record into its fields, honouring RFC 4180 quotes. */
function parseRecord(line: string): string[] {
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
    } else if (c === ',') {
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
        metadata: { username: '=HYPERLINK("http://example.com","x")' },
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

    const records = csv.split('\n').filter(Boolean).slice(1).map(parseRecord);
    expect(records).toHaveLength(events.length);
    for (const fields of records) {
      expect(fields).toHaveLength(9);
      for (const field of fields) expect(field).not.toMatch(/^[=+\-@\t\r]/);
    }
    expect(records[0][1]).toBe('\'=HYPERLINK("http://example.com","x")');
    expect(records[0][8]).toBe('\'@ip\rforged');
  });
});
