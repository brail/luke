/**
 * Every field of the audit log CSV export reaches a spreadsheet as inert text, and no
 * separator inside a value can split it, whatever the reader splits on (#93).
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

  it('quotes every value, doubling its quotes, and leaves its text unchanged', () => {
    expect(csvEscape('2026-10-09T08:15:00.000Z')).toBe('"2026-10-09T08:15:00.000Z"');
    expect(csvEscape('a,b;c\r\nd')).toBe('"a,b;c\r\nd"');
    expect(csvEscape('=HYPERLINK("x","y")')).toBe(`"'=HYPERLINK(""x"",""y"")"`);
    expect(csvEscape('')).toBe('""');
  });
});

describe('generateAuditLogCsv', () => {
  it('passes every column of every event through csvEscape', async () => {
    const createdAt = new Date('2026-10-09T08:15:00.000Z');
    const events = [
      {
        // A failed login: no actor, the subject is the typed username.
        createdAt, actorId: null, actor: null, action: 'AUTH_LOGIN', targetType: '+User',
        targetId: '-1', result: 'FAILURE', ip: '@ip\rforged', metadata: { username: 'x;=1+1' },
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

    const chunks: string[] = [];
    for await (const chunk of generateAuditLogCsv(prisma, {})) chunks.push(chunk);

    expect(chunks.slice(1)).toEqual([
      `"2026-10-09T08:15:00.000Z","x;=1+1","","soggetto","Accesso effettuato","'+User","'-1","FAILURE","'@ip\rforged"\n`,
      `"2026-10-09T08:15:00.000Z","'@Mario Rossi","'\tmario@example.com","utente","Accesso effettuato","User","u1","SUCCESS","127.0.0.1"\n`,
    ]);
  });

  it('starts each batch after the last row read, not at an offset', async () => {
    const base = Date.parse('2026-10-09T08:00:00.000Z');
    const fullBatch = Array.from({ length: 500 }, (_, i) => ({
      createdAt: new Date(base - i * 1000), id: `id-${i}`, actorId: null, actor: null, action: 'AUTH_LOGIN',
      targetType: 'User', targetId: null, result: 'SUCCESS', ip: null, metadata: null,
    }));
    const findMany = vi.fn().mockResolvedValueOnce(fullBatch).mockResolvedValue([]);
    // Only the two calls the generator makes; the rest of the client is never touched.
    const prisma = { auditLog: { findMany }, user: { findMany: async () => [] } } as unknown as PrismaClient;

    for await (const _chunk of generateAuditLogCsv(prisma, { result: 'SUCCESS' }));

    const last = fullBatch[499]!;
    const second = findMany.mock.calls[1]![0];
    expect(second).not.toHaveProperty('skip');
    expect(second.where).toEqual({
      AND: [
        { result: 'SUCCESS' },
        { OR: [{ createdAt: { lt: last.createdAt } }, { createdAt: last.createdAt, id: { lt: last.id } }] },
      ],
    });
  });
});
