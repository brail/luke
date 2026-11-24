/**
 * The audit trail shows another user's address only to a caller who also holds `users:read`
 * (#286, ADR-050): in the list (actor, subject, and the addresses recorded in a row's details) and
 * in the export, in both formats. `audit:read_all` alone reads names and usernames. The filter acts at
 * read time and leaves the stored rows unchanged. The export re-reads its requester's permissions when
 * the link is used, not only when it is made.
 */

import ExcelJS from 'exceljs';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { registerAuditLogExportDownloadRoute } from '../src/routes/auditLogExportDownload';
import { signAuditLogExportToken } from '../src/utils/downloadToken';

import { createCallerWithSession, createTestUser, grantEditor, setupTestDb } from './helpers';

const MASK = '[REDACTED: users:read]';

let prisma: PrismaClient;
let other: { id: string; email: string; username: string };

beforeEach(async () => {
  prisma = await setupTestDb();
  ({ user: other } = await createTestUser('viewer'));
});

/** A row by `other`, a pre-session row about `other`, both recording addresses in their details. */
async function seedRows() {
  const details = {
    email: other.email,
    emailHolderId: other.id,
    username: other.username,
    nested: { userEmail: 'mailbox@example.com', items: [{ deletedEmail: 'gone@example.com' }] },
    sectionAccessDefaults: { editor: { email: 'map@example.com' } },
  };
  await prisma.auditLog.createMany({
    data: [
      { actorId: other.id, action: 'USER_UPDATE', targetType: 'User', targetId: other.id, result: 'SUCCESS', metadata: details },
      { actorId: null, action: 'AUTH_LOGIN', targetType: 'Auth', targetId: other.id, result: 'SUCCESS', metadata: { username: other.username } },
      // A failed login on no account, the username typed as an address: its subject is that text.
      { actorId: null, action: 'AUTH_LOGIN_FAILED', targetType: 'Auth', targetId: null, result: 'FAILURE', metadata: { username: 'typed@mail.example' } },
    ],
  });
}

async function listAs(session: Parameters<typeof createCallerWithSession>[0]) {
  return (await createCallerWithSession(session).auditLog.list({ page: 1, limit: 50 })).items;
}

describe('auditLog.list', () => {
  it('shows addresses to a caller holding users:read, and stores nothing new', async () => {
    await seedRows();
    const before = await prisma.auditLog.findMany({ orderBy: { action: 'asc' } });
    const { session } = await createTestUser('admin');

    const items = await listAs(session);
    const update = items.find(i => i.action === 'USER_UPDATE');
    const login = items.find(i => i.action === 'AUTH_LOGIN');

    expect(update?.actorEmail).toBe(other.email);
    expect(update?.metadata).toMatchObject({ email: other.email, nested: { userEmail: 'mailbox@example.com' } });
    expect(login?.subjectEmail).toBe(other.email);
    expect(await prisma.auditLog.findMany({ orderBy: { action: 'asc' } })).toEqual(before);
  });

  it('masks every address for audit:read_all without users:read, names and usernames kept', async () => {
    grantEditor('audit:read_all');
    await seedRows();
    const before = await prisma.auditLog.findMany({ orderBy: { action: 'asc' } });
    const { user: self, session } = await createTestUser('editor');
    await prisma.auditLog.create({
      data: { actorId: self.id, action: 'USER_PREFERENCE_UPDATE', targetType: 'User', targetId: self.id, result: 'SUCCESS', metadata: { email: self.email } },
    });

    const items = await listAs(session);
    const update = items.find(i => i.action === 'USER_UPDATE');
    const login = items.find(i => i.action === 'AUTH_LOGIN');
    const own = items.find(i => i.action === 'USER_PREFERENCE_UPDATE');

    expect(update?.actorName).toBeTruthy();
    expect(update?.actorEmail).toBeNull();
    expect(update?.metadata).toEqual({
      email: MASK,
      emailHolderId: other.id,
      username: other.username,
      nested: { userEmail: MASK, items: [{ deletedEmail: MASK }] },
      sectionAccessDefaults: { editor: { email: MASK } },
    });
    expect(login?.subjectName).toBeTruthy();
    expect(login?.subjectEmail).toBeNull();
    const typed = items.find(i => i.action === 'AUTH_LOGIN_FAILED');
    expect(typed?.subjectName).toBeNull();
    expect(typed?.metadata).toEqual({ username: MASK });
    // One rule, the caller's own address included (their profile shows it).
    expect(own?.actorEmail).toBeNull();
    expect(own?.metadata).toEqual({ email: MASK });
    expect(await prisma.auditLog.findMany({ where: { action: { not: 'USER_PREFERENCE_UPDATE' } }, orderBy: { action: 'asc' } })).toEqual(before);
  });
});

describe('the export', () => {
  async function download(token: string, format: 'csv' | 'xlsx') {
    const app = Fastify();
    await registerAuditLogExportDownloadRoute(app, prisma);
    return app.inject({ method: 'GET', url: `/download/audit-log?format=${format}&token=${encodeURIComponent(token)}` });
  }

  /** The `Email` column of every data row, in both formats. */
  async function emailColumn(token: string): Promise<{ csv: string[]; xlsx: string[] }> {
    const csv = await download(token, 'csv');
    expect(csv.statusCode).toBe(200);
    const csvEmails = csv.body
      .replace(/^\uFEFF/, '')
      .trim()
      .split('\n')
      .slice(1)
      .map(line => (line.match(/"((?:[^"]|"")*)"/g) ?? [])[2]?.slice(1, -1) ?? '');

    const xlsx = await download(token, 'xlsx');
    expect(xlsx.statusCode).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(xlsx.rawPayload).buffer);
    const sheet = workbook.getWorksheet('Audit Log')!;
    const xlsxEmails: string[] = [];
    sheet.eachRow((row, n) => {
      if (n > 1) xlsxEmails.push(String(row.getCell(3).value ?? ''));
    });
    return { csv: csvEmails, xlsx: xlsxEmails };
  }

  async function linkFor(session: Parameters<typeof createCallerWithSession>[0]) {
    return (await createCallerWithSession(session).auditLog.getExportLink({})).token;
  }

  it('fills the Email column for a requester holding users:read, in CSV and XLSX', async () => {
    await seedRows();
    const { session } = await createTestUser('admin');

    const { csv, xlsx } = await emailColumn(await linkFor(session));

    expect(csv).toEqual([other.email, other.email, '']);
    expect(xlsx).toEqual([other.email, other.email, '']);
  });

  it('leaves the Email column empty for audit:read_all without users:read', async () => {
    grantEditor('audit:read_all');
    await seedRows();
    const { session } = await createTestUser('editor');

    const { csv, xlsx } = await emailColumn(await linkFor(session));

    expect(csv).toEqual(['', '', '']);
    expect(xlsx).toEqual(['', '', '']);
  });

  it('reads the requester again when the link is used: a lost permission counts at once', async () => {
    await seedRows();
    const { user, session } = await createTestUser('admin');
    const token = await linkFor(session);

    // Demoted after the link was made: no audit:read_all any more, nothing is served.
    await prisma.user.update({ where: { id: user.id }, data: { role: 'viewer' } });
    expect((await download(token, 'csv')).statusCode).toBe(403);

    // Kept the audit but lost users:read (editor + audit:read_all): served without addresses.
    grantEditor('audit:read_all');
    await prisma.user.update({ where: { id: user.id }, data: { role: 'editor' } });
    expect((await emailColumn(token)).csv).toEqual(['', '', '']);

    // Deactivated: refused.
    await prisma.user.update({ where: { id: user.id }, data: { role: 'admin', isActive: false } });
    expect((await download(token, 'csv')).statusCode).toBe(403);
  });

  it('ends a link whose requester has had their sessions revoked since', async () => {
    await seedRows();
    const { user, session } = await createTestUser('admin');
    const token = await linkFor(session);

    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });

    expect((await download(token, 'csv')).statusCode).toBe(403);
  });

  it('refuses a link that names no requester', async () => {
    // A link made before the requester was signed in: `JSON.stringify` drops the undefined claim.
    const legacy = signAuditLogExportToken({ filters: {}, timeZone: 'Europe/Rome', userId: undefined as never });

    expect((await download(legacy, 'csv')).statusCode).toBe(401);
  });
});
