/**
 * `logAudit` from a context with no HTTP request: a CLI script, a background flow.
 *
 * It used to read `ctx.req.ip` and log through `ctx.req.log`, so with no request it threw before or
 * after writing. That is why the verification email sent when LDAP provisions a user never left its
 * `EMAIL_VERIFICATION_SENT` row: the caller has no request to give.
 *
 * Writing the row and logging about it are kept apart, so a logger that throws can neither turn a
 * written row into a failure nor hide the database error behind its own. A failed write is swallowed
 * for an ordinary action, and thrown for an action in `CRITICAL_AUDIT_ACTIONS` or when the caller
 * requires the write.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@luke/db';

import { logAudit, type AuditContext } from '../src/lib/auditLog';
import { sendVerificationEmail } from '../src/lib/emailHelpers';

import { createTestContext, createTestUser, setupTestDb } from './helpers';

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = await setupTestDb();
});

const ordinary = { action: 'USER_UPDATE', targetType: 'User', targetId: 'u-1' } as const;
const critical = { action: 'CONFIG_UPSERT', targetType: 'AppConfig', targetId: 'k' } as const;

/** A database whose audit write fails. */
const failingDatabase = (error: Error) =>
  // Only `auditLog.create` is reached by `logAudit`; the rest of the client is never touched.
  ({ auditLog: { create: vi.fn().mockRejectedValue(error) } }) as unknown as AuditContext['prisma'];

/** A logger that throws on every call. */
const throwingLogger = {
  info: () => { throw new Error('logger down'); },
  error: () => { throw new Error('logger down'); },
} as unknown as AuditContext['logger']; // only `info` and `error` are called

async function rowsFor(targetId: string) {
  return prisma.auditLog.findMany({ where: { targetId } });
}

describe('logAudit without a request', () => {
  it('writes its row, with no IP and no actor', async () => {
    await logAudit({ prisma }, ordinary);

    expect(await rowsFor('u-1')).toMatchObject([{ action: 'USER_UPDATE', ip: null, actorId: null }]);
  });

  it('keeps a written row when the logger throws', async () => {
    await expect(logAudit({ prisma, logger: throwingLogger }, ordinary)).resolves.toBeUndefined();

    expect(await rowsFor('u-1')).toHaveLength(1);
  });

  describe('a failed write', () => {
    const lost = new Error('database unreachable');

    it('is swallowed for an ordinary action', async () => {
      await expect(logAudit({ prisma: failingDatabase(lost) }, ordinary)).resolves.toBeUndefined();
    });

    it('is thrown for a critical action', async () => {
      await expect(logAudit({ prisma: failingDatabase(lost) }, critical)).rejects.toBe(lost);
    });

    it('is thrown when the caller requires the write', async () => {
      await expect(logAudit({ prisma: failingDatabase(lost) }, ordinary, { required: true })).rejects.toBe(lost);
    });

    it('stays the database error when the logger throws too', async () => {
      await expect(
        logAudit({ prisma: failingDatabase(lost), logger: throwingLogger }, ordinary, { required: true }),
      ).rejects.toBe(lost);
      await expect(
        logAudit({ prisma: failingDatabase(lost), logger: throwingLogger }, ordinary),
      ).resolves.toBeUndefined();
    });
  });
});

describe('logAudit with a request', () => {
  it('records actor, IP and trace as before', async () => {
    const { user, session } = await createTestUser('admin');
    const ctx = createTestContext(session);

    await logAudit(ctx, ordinary);

    expect(await rowsFor('u-1')).toMatchObject([{ actorId: user.id, ip: '127.0.0.1', traceId: ctx.traceId }]);
  });
});

describe('the verification email of an LDAP-provisioned user', () => {
  // Provisioning calls it with no context at all. SMTP is not configured here, so the send fails
  // and the row to look for is the FAILURE one; the success row takes the same path.
  it('leaves its audit row although no request exists', async () => {
    const { user } = await createTestUser('viewer');
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });

    await expect(sendVerificationEmail(prisma, { userId: user.id, reason: 'user_created' })).rejects.toThrow();

    expect(await rowsFor(user.id)).toMatchObject([{ action: 'EMAIL_VERIFICATION_SENT', result: 'FAILURE', ip: null }]);
  });
});
